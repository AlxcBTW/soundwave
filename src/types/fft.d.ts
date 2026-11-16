declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    readonly size: number;
    createComplexArray(): number[];
    realTransform(output: number[], input: ArrayLike<number>): void;
    completeSpectrum(output: number[]): void;
    transform(output: number[], input: number[]): void;
  }
}
