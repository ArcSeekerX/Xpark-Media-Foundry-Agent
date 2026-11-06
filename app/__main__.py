import uvicorn

from . import config
from .api import create_app

if __name__ == "__main__":
    uvicorn.run(create_app(), host=config.HOST, port=config.PORT,
                log_level="info")
