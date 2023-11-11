import datetime
import os
import random
from collections import defaultdict
from threading import Lock
from typing import Annotated

import pandas as pd
from fastapi import FastAPI, Request, Body, HTTPException
from openai import AsyncOpenAI
from starlette.middleware.cors import CORSMiddleware
from starlette.status import HTTP_413_REQUEST_ENTITY_TOO_LARGE

from .utils import load_datasets, throttle

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=['*'],
)
# state
app.state.last_called = defaultdict(lambda: datetime.datetime.fromtimestamp(0))
app.state.lock = Lock()

# constants
DATASETS = load_datasets()
API_TOKEN = os.environ['API_TOKEN']
DEV = bool(int(os.environ['DEV']))
MAX_TOKENS = 2000
FREE_TOKEN = 'free'

BodyStr = Annotated[str, Body()]


@app.get('/api/sample/')
async def sample(request: Request, min_length: int = 0, max_length: int | None = None):
    throttle(request, 'sample', 1)

    # TODO: add more datasets
    storage = DATASETS['TinyStories']
    if max_length is None:
        max_length = float('inf')

    candidates = [path for path, start, stop in storage if min_length <= stop and start <= max_length]
    text = ''
    if candidates:
        df = pd.read_csv(random.choice(candidates))
        df = df[(df.Length <= max_length) & (df.Length >= min_length)]
        if len(df):
            text = df.sample(1).iloc[0].Text

    return {'text': text}


@app.post('/api/check/')
async def check(request: Request, original: BodyStr, translation: BodyStr, sourceLanguage: BodyStr,
                targetLanguage: BodyStr, token: BodyStr):
    if free_token := token == FREE_TOKEN:
        token = API_TOKEN
    throttle(request, ('check', free_token), 360 if free_token else 1)

    prompt = f'<{sourceLanguage}>\n{original}\n<translation to {targetLanguage}>\n{translation}\n<fixed translation>'
    if free_token and len(prompt) > MAX_TOKENS * 2:
        raise HTTPException(HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    # saving some money while debugging
    if DEV:
        result = translation + '(currently the server is running in DEV mode)'
    else:
        client = AsyncOpenAI(api_key=token)
        response = await client.chat.completions.create(
            model='gpt-3.5-turbo', max_tokens=MAX_TOKENS if free_token else None,
            messages=[{'role': 'user', 'content': prompt}],
        )
        result = response.choices[0].message.content

    return {'text': result}
