import datetime
import os
from collections import defaultdict
from pathlib import Path

from fastapi import Request, HTTPException
from starlette.status import HTTP_429_TOO_MANY_REQUESTS


def load_datasets():
    datasets = defaultdict(list)
    for f in Path(os.environ['DATASETS_ROOT']).glob('*/*'):
        start, stop, _ = f.stem.split('-')
        datasets[f.parent.name].append((f, int(start), int(stop)))

    return dict(datasets)


def throttle(request: Request, key, interval):
    with request.app.state.lock:
        previous = request.app.state.last_called[key]
        now = datetime.datetime.now()
        if now - previous < datetime.timedelta(seconds=interval):
            raise HTTPException(HTTP_429_TOO_MANY_REQUESTS)
        request.app.state.last_called[key] = now
