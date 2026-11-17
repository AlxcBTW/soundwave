"""Makes the stem-separation model file the game downloads for advanced analysis.

    ml-service/.venv/Scripts/python tools/analysis/export_stem_model.py out/htdemucs-v1.onnx

Needs the packages of `ml-service/requirements-full.txt` plus `onnx`. It exports Demucs `htdemucs`
(one model, four stems) to ONNX with the short-time Fourier transform left out of the graph: the
game computes that itself (src/analysis/separation/stft.ts), which keeps the graph to operators
every ONNX Runtime backend has, WebGPU included.

Graph, one 7.8 s stereo segment at 44.1 kHz. Names, shapes and meaning are those of the copy Intel
publishes for its Audacity plugins (huggingface.co/Intel/demucs-openvino, htdemucs_v4), so the game
can load either file:
  inputs   x      [1, 4, 2048, 336]   the spectrogram (left re, left im, right re, right im),
                                      less its mean and divided by its standard deviation
           xt     [1, 2, 343980]      the segment, normalised the same way
  outputs  x_out  [1, 16, 2048, 336]  per stem (drums, bass, other, vocals), the same four planes
           xt_out [1, 8, 343980]      per stem, the two channels of the time-domain branch
Both outputs are still normalised: the game multiplies by the deviation and adds the mean back.
The stem is the inverse transform of `x_out` plus `xt_out`.

Weights are stored as float16 wherever that is exact (the published weights are float16), and cast
back to float32 as the graph loads, so the file is half the size and computes the same numbers.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import torch
from einops import rearrange
from onnx import TensorProto, helper, numpy_helper

from demucs.pretrained import get_model


class Core(torch.nn.Module):
    """HTDemucs.forward without the transform and the normalisation at either end (see demucs/htdemucs.py)."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.m = model

    def forward(self, x: torch.Tensor, xt: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        m = self.m
        B, _, Fq, T = x.shape
        length = xt.shape[-1]
        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)
        if m.crosstransformer:
            if m.bottom_channels:
                _, _, f, _ = x.shape
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_upsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_downsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_downsampler_t(xt)
        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip, length_t)
        return x.reshape(B, -1, Fq, T), xt.reshape(B, -1, length)


def store_float16(path: Path) -> tuple[int, int]:
    """Rewrites large float32 weights as float16 + Cast where that loses nothing."""
    model = onnx.load(str(path))
    graph = model.graph
    casts, kept = [], 0
    for init in list(graph.initializer):
        if init.data_type != TensorProto.FLOAT or int(np.prod(init.dims)) < 256:
            continue
        values = numpy_helper.to_array(init)
        half = values.astype(np.float16)
        if not np.array_equal(half.astype(np.float32), values):
            kept += 1
            continue
        name = init.name
        graph.initializer.remove(init)
        graph.initializer.append(numpy_helper.from_array(half, name + "_f16"))
        casts.append(helper.make_node("Cast", [name + "_f16"], [name], to=TensorProto.FLOAT, name="cast_" + name))
    for i, node in enumerate(casts):
        graph.node.insert(i, node)
    onnx.save(model, str(path))
    return len(casts), kept


def main() -> None:
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    model = get_model("htdemucs").models[0].eval()
    segment = int(model.segment * model.samplerate)
    core = Core(model).eval()
    torch.manual_seed(0)
    mix = torch.randn(1, 2, segment) * 0.1
    with torch.no_grad():
        z = model._spec(mix)
        mag = model._magnitude(z)
        reference = model(mix)
    mean, std, meant, stdt = mag.mean(), mag.std(), mix.mean(), mix.std()
    x = (mag - mean) / (1e-5 + std)
    xt = (mix - meant) / (1e-5 + stdt)
    torch.onnx.export(core, (x, xt), str(out), dynamo=False, input_names=["x", "xt"], output_names=["x_out", "xt_out"], opset_version=17)
    stored, kept = store_float16(out)

    import onnxruntime as ort

    x_out, xt_out = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"]).run(None, {"x": x.numpy(), "xt": xt.numpy()})
    spec = torch.from_numpy(x_out).view(1, 4, 4, 2048, 336) * std + mean
    wave = torch.from_numpy(xt_out).view(1, 4, 2, segment) * stdt + meant
    with torch.no_grad():
        rebuilt = model._ispec(model._mask(z, spec), segment) + wave
    snr = 10 * torch.log10(reference.pow(2).mean() / (rebuilt - reference).pow(2).mean())
    data = out.read_bytes()
    print(f"{out}: {len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()}")
    print(f"sources {model.sources}, segment {segment} samples; {stored} weights stored as float16, {kept} kept as float32")
    print(f"against PyTorch on one segment: {snr:.1f} dB")


if __name__ == "__main__":
    main()
