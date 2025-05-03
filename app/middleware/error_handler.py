"""
Error handling middleware for the FastAPI application.
Provides consistent error handling and logging.
"""

from fastapi import Request, status
from fastapi.responses import JSONResponse
from loguru import logger
import traceback
from typing import Callable, Awaitable
import time

async def error_handling_middleware(
    request: Request, 
    call_next: Callable[[Request], Awaitable]
) -> JSONResponse:
    """
    Middleware to handle errors and log all requests.
    
    Args:
        request: The incoming request
        call_next: The next middleware or endpoint handler
        
    Returns:
        Response from the endpoint or a JSON error response
    """
    start_time = time.time()
    
    # Log request info
    logger.info(f"{request.method} {request.url.path}")
    
    try:
        # Process the request
        response = await call_next(request)
        
        # Log success responses
        process_time = time.time() - start_time
        logger.info(f"Request completed in {process_time:.3f}s: {request.method} {request.url.path} - {response.status_code}")
        
        return response
    
    except Exception as e:
        # Log the error with traceback
        process_time = time.time() - start_time
        logger.error(f"Error processing request ({process_time:.3f}s): {request.method} {request.url.path}")
        logger.error(f"Error details: {str(e)}")
        logger.error(traceback.format_exc())
        
        # Close any open database sessions
        try:
            from app.database.session import close_thread_sessions
            close_thread_sessions()
        except:
            pass
        
        # Return a JSON error response
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": "Internal server error",
                "error": str(e) if not isinstance(e, str) else e
            }
        )
