#!/usr/bin/env python
"""
YIFY Torrent Downloader Shell
A shell environment for testing and debugging the application

This script sets up an interactive Python shell with all necessary
components pre-imported and ready to use.
"""

import os
import sys
import asyncio
import warnings
from pathlib import Path

# Add the application directory to the Python path if needed
app_path = Path(__file__).resolve().parent
if str(app_path) not in sys.path:
    sys.path.append(str(app_path))

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore")

try:
    # Apply nest_asyncio to allow running asyncio in interactive shell
    import nest_asyncio
    nest_asyncio.apply()
except ImportError:
    print("Warning: nest_asyncio not installed. Some async functions may not work in the shell.")
    print("Install with: pip install nest_asyncio")

# Set up colorful output
class Colors:
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    END = '\033[0m'

def print_header():
    """Print a colorful header for the shell."""
    print(f"\n{Colors.BLUE}{'='*70}{Colors.END}")
    print(f"{Colors.BOLD}YIFY Torrent Downloader Interactive Shell{Colors.END}")
    print(f"{Colors.BLUE}{'='*70}{Colors.END}\n")
    print(f"{Colors.GREEN}Available components:{Colors.END}")
    print(f"  {Colors.YELLOW}* app{Colors.END} - FastAPI application instance")
    print(f"  {Colors.YELLOW}* db{Colors.END} - Database session")
    print(f"  {Colors.YELLOW}* models{Colors.END} - Database models")
    print(f"  {Colors.YELLOW}* pydantic_models{Colors.END} - Pydantic models")
    print(f"  {Colors.YELLOW}* torrent_manager{Colors.END} - Torrent management service")
    print(f"  {Colors.YELLOW}* schedule_manager{Colors.END} - Schedule management service")
    print(f"  {Colors.YELLOW}* yts{Colors.END} - YTS scraper functions")
    print(f"  {Colors.YELLOW}* settings{Colors.END} - Application settings")
    print(f"\n{Colors.GREEN}Helper functions:{Colors.END}")
    print(f"  {Colors.YELLOW}* run_async(coro){Colors.END} - Run an async function")
    print(f"  {Colors.YELLOW}* search(title){Colors.END} - Quick search for movies by title")
    print(f"  {Colors.YELLOW}* list_torrents(){Colors.END} - List all torrents")
    print(f"  {Colors.YELLOW}* list_schedules(){Colors.END} - List all schedules")
    print(f"  {Colors.YELLOW}* check_status(){Colors.END} - Display system status")
    print(f"  {Colors.YELLOW}* query_db(func){Colors.END} - Execute a database query safely")
    
    print(f"\n{Colors.GREEN}Example commands:{Colors.END}")
    print(f"  {Colors.YELLOW}* search('The Matrix'){Colors.END} - Search for movies with 'The Matrix' in the title")
    print(f"  {Colors.YELLOW}* check_status(){Colors.END} - Check the system status")
    print(f"  {Colors.YELLOW}* run_async(yts.browse_yts(pydantic_models['SearchParams'](year=2024))){Colors.END} - Search 2024 movies")
    
    print(f"\n{Colors.BLUE}{'='*70}{Colors.END}\n")

def run_async(coro):
    """Run an async coroutine from the synchronous shell context."""
    return asyncio.run(coro)

def setup_shell():
    """Set up the shell environment with all necessary imports and components."""
    # Create shell namespace
    namespace = {}
    
    try:
        # Import settings first to modify log path before importing app
        from app.config import settings
        
        # Override log settings to avoid permission issues
        import os
        from pathlib import Path
        
        # Redirect logs to a file in the current directory
        log_dir = Path('./logs')
        log_dir.mkdir(exist_ok=True)
        settings.log_path = log_dir
        
        # Import FastAPI application after modifying settings
        from app.main import app
        namespace['app'] = app
        
        # Import database components
        from app.database.session import get_db, SessionLocal
        from app.database import models
        
        # Create a database session using SessionLocal directly
        db = SessionLocal()
        namespace['db'] = db
        namespace['models'] = models
        
        # Import pydantic models
        from app.models import (
            Movie, Torrent, TorrentStatus, TorrentState, 
            SearchParams, ScheduleConfig, ScheduleResponse
        )
        namespace['pydantic_models'] = {
            'Movie': Movie,
            'Torrent': Torrent,
            'TorrentStatus': TorrentStatus,
            'TorrentState': TorrentState,
            'SearchParams': SearchParams,
            'ScheduleConfig': ScheduleConfig,
            'ScheduleResponse': ScheduleResponse
        }
        
        # Import services
        from app.torrent.manager import torrent_manager
        from app.cron.jobs import schedule_manager
        namespace['torrent_manager'] = torrent_manager
        namespace['schedule_manager'] = schedule_manager
        
        # Import scrapers
        from app.scrapers import yts
        namespace['yts'] = yts
        
        # Import settings
        from app.config import settings
        namespace['settings'] = settings
        
        # Helper functions
        namespace['run_async'] = run_async
        
        # Diagnostic commands
        def check_system_status():
            """Print system status information."""
            print(f"\n{Colors.BLUE}System Status:{Colors.END}")
            print(f"  Database: {'Connected' if db else 'Not connected'}")
            print(f"  Torrent Manager: {'Initialized' if torrent_manager else 'Not initialized'}")
            print(f"  Schedule Manager: {'Initialized' if schedule_manager else 'Not initialized'}")
            print(f"  Download Path: {settings.default_download_path}")
            print(f"  Max Active Downloads: {settings.max_active_downloads}")
            print(f"  Log Level: {settings.log_level}")
            print(f"  Scheduler Enabled: {settings.cron_enabled}")
            
            # Check active torrents
            try:
                active_torrents = torrent_manager.get_all_torrents()
                print(f"  Active Torrents: {len(active_torrents)}")
            except Exception as e:
                print(f"  Active Torrents: Error - {e}")
            
            # Check schedules
            try:
                schedules = db.query(models.Schedule).count()
                print(f"  Scheduled Jobs: {schedules}")
            except Exception as e:
                print(f"  Scheduled Jobs: Error - {e}")
                
        namespace['check_status'] = check_system_status
        
        # Add search helper
        def quick_search(title):
            """Quick search for movies by title."""
            print(f"\n{Colors.BLUE}Searching for: {title}{Colors.END}")
            async def _search():
                from app.scrapers.yts import search_movie
                results = await search_movie(title)
                if results:
                    print(f"\n{Colors.GREEN}Found {len(results)} results:{Colors.END}")
                    for i, movie in enumerate(results):
                        print(f"  {i+1}. {movie.title} ({movie.year}) - {movie.rating}")
                else:
                    print(f"\n{Colors.YELLOW}No results found{Colors.END}")
                return results
            return run_async(_search())
            
        namespace['search'] = quick_search
        
        # Search movies helper
        async def search_movies(title):
            return await yts.search_movie(title)
        namespace['search_movies'] = lambda title: run_async(search_movies(title))
        
        # List torrents helper
        def list_torrents():
            return torrent_manager.get_all_torrents()
        namespace['list_torrents'] = list_torrents
        
        # List schedules helper
        def list_schedules():
            return db.query(models.Schedule).all()
        namespace['list_schedules'] = list_schedules
        
        # Add a function to execute database queries safely
        def query_db(query_func):
            """Execute a database query function with proper session handling."""
            try:
                result = query_func(db)
                return result
            except Exception as e:
                print(f"{Colors.RED}Database query error: {e}{Colors.END}")
                return None
        namespace['query_db'] = query_db
        
        print_header()
        
        return namespace
        
    except Exception as e:
        print(f"{Colors.RED}Error setting up shell: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
        return {}

def start_shell():
    """Start an interactive shell with the application components."""
    namespace = setup_shell()
    
    if not namespace:
        print(f"{Colors.RED}Failed to set up shell environment. Exiting.{Colors.END}")
        return
    
    # Try to use IPython if available, fall back to standard Python shell
    try:
        print(f"{Colors.GREEN}Starting interactive shell...{Colors.END}")
        print(f"{Colors.YELLOW}Type exit() or Ctrl+D to exit{Colors.END}")
        
        from IPython import start_ipython
        start_ipython(argv=[], user_ns=namespace)
    except ImportError:
        import code
        code.interact(local=namespace, banner="")
    finally:
        # Clean up resources when shell exits
        print(f"{Colors.BLUE}Cleaning up resources...{Colors.END}")
        if 'db' in namespace:
            try:
                namespace['db'].close()
                print(f"{Colors.GREEN}Database session closed.{Colors.END}")
            except Exception as e:
                print(f"{Colors.RED}Error closing database: {e}{Colors.END}")

if __name__ == "__main__":
    start_shell()