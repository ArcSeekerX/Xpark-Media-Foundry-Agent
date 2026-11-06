#!/usr/bin/env bash
# Start the Video Agent Studio (chat + digital asset library) on :5100.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple \
    -r requirements.txt
fi

exec .venv/bin/python -m app
