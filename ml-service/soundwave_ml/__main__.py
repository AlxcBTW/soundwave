import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Soundwave analysis service")
    parser.add_argument("--host", default="127.0.0.1", help="interface to bind (keep it local)")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run("soundwave_ml.server:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
