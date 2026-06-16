import asyncio
import json
import uuid
from datetime import datetime
from croniter import croniter
from loguru import logger
import random
from typing import List, Dict, Optional, Any
from sqlalchemy.orm import Session

from app.database.session import get_db, init_db
from app.database.models import Schedule as DbSchedule
from app.database.models import ScheduleLog as DbScheduleLog
from app.database.utils import schedule_db_to_response
from app.models import SearchParams, ScheduleConfig, ScheduleResponse
from app.config import settings
from app.scrapers.yts import browse_yts
from app.torrent.manager import torrent_manager


class ScheduleManager:
    """Manages scheduled downloads based on cron expressions"""
    
    def __init__(self):
        # Initialize database
        init_db()
        self.running_task = None
    
    def add_schedule(self, config: ScheduleConfig) -> str:
        """Add a new scheduled job"""
        try:
            schedule_id = str(uuid.uuid4())
            
            # Calculate next run time
            cron = croniter(config.cron_expression, datetime.now())
            next_run = cron.get_next(datetime)
            
            # Create new schedule in database
            with get_db() as db:
                new_schedule = DbSchedule(
                    id=schedule_id,
                    name=config.name,
                    cron_expression=config.cron_expression,
                    search_params=config.search_params.dict(),
                    quality=config.quality,
                    max_downloads=config.max_downloads,
                    enabled=config.enabled,
                    next_run=next_run
                )
                db.add(new_schedule)
                db.commit()
            
            logger.info(f"Added new schedule: {schedule_id} - Next run: {next_run}")
            return schedule_id
        except Exception as e:
            logger.error(f"Error adding schedule: {e}")
            raise
    
    def update_schedule(self, schedule_id: str, config: ScheduleConfig) -> bool:
        """Update an existing scheduled job"""
        try:
            # Calculate next run time
            cron = croniter(config.cron_expression, datetime.now())
            next_run = cron.get_next(datetime)
            
            with get_db() as db:
                schedule: DbSchedule = db.query(DbSchedule).filter(DbSchedule.id == schedule_id).first()
                
                if not schedule:
                    return False
                
                # Update fields
                schedule.name = config.name
                schedule.cron_expression = config.cron_expression
                schedule.search_params = config.search_params.model_dump()
                schedule.quality = config.quality
                schedule.max_downloads = config.max_downloads
                schedule.enabled = config.enabled
                schedule.next_run = next_run
                
                db.commit()
            
            logger.info(f"Updated schedule: {schedule_id} - Next run: {next_run}")
            return True
        except Exception as e:
            logger.error(f"Error updating schedule: {e}")
            return False
    
    def delete_schedule(self, schedule_id: str) -> bool:
        """Delete a scheduled job"""
        try:
            with get_db() as db:
                schedule = db.query(DbSchedule).filter(DbSchedule.id == schedule_id).first()
                
                if not schedule:
                    return False
                
                db.delete(schedule)
                db.commit()
            
            logger.info(f"Deleted schedule: {schedule_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting schedule: {e}")
            return False
    
    def get_schedule(self, schedule_id: str) -> Optional[ScheduleResponse]:
        """Get a scheduled job by ID"""
        try:
            with get_db() as db:
                schedule = db.query(DbSchedule).filter(DbSchedule.id == schedule_id).first()
                
                if not schedule:
                    return None
                
                return schedule_db_to_response(schedule)
        except Exception as e:
            logger.error(f"Error getting schedule {schedule_id}: {e}")
            return None
    
    def get_all_schedules(self) -> List[ScheduleResponse]:
        """Get all scheduled jobs"""
        try:
            with get_db() as db:
                schedules = db.query(DbSchedule).all()
                
                return [schedule_db_to_response(schedule) for schedule in schedules]
        except Exception as e:
            logger.error(f"Error getting all schedules: {e}")
            return []
    
    def _update_next_run(self, schedule_id: str, last_run: datetime, status: str = "completed"):
        """Update the next run time and status for a scheduled job"""
        try:
            with get_db() as db:
                schedule = db.query(DbSchedule).filter(DbSchedule.id == schedule_id).first()
                
                if not schedule:
                    return
                
                # Calculate the next run time
                cron = croniter(schedule.cron_expression, last_run)
                next_run = cron.get_next(datetime)
                
                # Update fields
                schedule.last_run = last_run
                schedule.next_run = next_run
                schedule.last_run_status = status
                
                # Create execution log
                log_entry = DbScheduleLog(
                    schedule_id=schedule_id,
                    execution_time=last_run,
                    status=status
                )
                db.add(log_entry)
                
                db.commit()
            
            logger.info(f"Updated schedule {schedule_id} next run to {next_run}")
        except Exception as e:
            logger.error(f"Error updating next run for schedule {schedule_id}: {e}")
    
    async def _execute_and_cleanup(self, schedule_id: str) -> bool:
        """Execute a schedule and ensure cleanup even if errors occur"""
        try:
            # Execute the schedule
            result = await self.execute_schedule(schedule_id)
            return result
        except Exception as e:
            logger.error(f"Unhandled error in schedule execution {schedule_id}: {e}")
            return False
        finally:
            # Always remove from currently executing set
            self._currently_executing.discard(schedule_id)
    
    async def _execute_and_cleanup(self, schedule_id: str) -> bool:
        """Execute a schedule and ensure cleanup even if errors occur"""
        try:
            # Execute the schedule
            result = await self.execute_schedule(schedule_id)
            return result
        except Exception as e:
            logger.error(f"Unhandled error in schedule execution {schedule_id}: {e}")
            logger.exception("Exception details:")
            return False
        finally:
            # Always remove from currently executing set
            self._currently_executing.discard(schedule_id)

    async def execute_schedule(self, schedule_id: str) -> bool:
        """Execute a scheduled job immediately"""
        # Prevent concurrent execution of the same schedule
        if schedule_id in self._currently_executing:
            logger.warning(f"Schedule {schedule_id} is already being executed")
            return False
            
        # Add to currently executing set
        self._currently_executing.add(schedule_id)
        
        try:
            # Get the schedule
            schedule = self.get_schedule(schedule_id)
            if not schedule:
                logger.error(f"Schedule {schedule_id} not found")
                self._currently_executing.discard(schedule_id)
                return False
            
            # Mark as running with optimistic locking to prevent race conditions
            with get_db() as db:
                schedule_db = db.query(DbSchedule).filter(
                    DbSchedule.id == schedule_id,
                    DbSchedule.last_run_status != "running"
                ).first()
                
                if not schedule_db:
                    logger.warning(f"Schedule {schedule_id} was already running or modified by another process")
                    self._currently_executing.discard(schedule_id)
                    return False
                    
                schedule_db.last_run_status = "running"
                db.commit()
            
            logger.info(f"Executing schedule {schedule_id}")
            
            # Execute the search
            movies = await browse_yts(schedule.config.search_params)
            
            if not movies:
                logger.info(f"No movies found for schedule {schedule_id}")
                self._update_next_run(schedule_id, datetime.now(), "completed (no movies found)")
                return True
            
            # Sort movies by rating (highest first)
            movies.sort(key=lambda m: float(m.rating.split('/')[0]), reverse=True)
            
            # Take only the number of movies specified by max_downloads
            selected_movies = movies[:schedule.config.max_downloads]
            
            # Log results
            results = {
                "movies_found": len(movies),
                "movies_selected": len(selected_movies),
                "selected_titles": [m.title for m in selected_movies]
            }
            
            logger.info(f"Found {len(selected_movies)} movies to download for schedule {schedule_id}")
            
            # Download each movie
            downloaded_count = 0
            for movie in selected_movies:
                try:
                    # Find the torrent with the requested quality
                    matching_torrents = [t for t in movie.torrents if t.quality == schedule.config.quality]
                    
                    if not matching_torrents:
                        logger.warning(f"No {schedule.config.quality} torrent found for {movie.title}")
                        continue
                    
                    torrent = matching_torrents[0]
                    
                    # Start the download
                    await torrent_manager.add_torrent(movie, torrent)
                    downloaded_count += 1
                    
                    logger.info(f"Started download for {movie.title} ({schedule.config.quality})")
                except Exception as e:
                    logger.error(f"Error downloading {movie.title}: {e}")
            
            # Update results
            results["downloads_started"] = downloaded_count
            
            # Store log entry
            with get_db() as db:
                log_entry = DbScheduleLog(
                    schedule_id=schedule_id,
                    execution_time=datetime.now(),
                    status="completed",
                    results=results
                )
                db.add(log_entry)
                db.commit()
            
            # Update the next run time
            self._update_next_run(schedule_id, datetime.now())
            
            return True
        except Exception as e:
            logger.error(f"Error executing schedule {schedule_id}: {e}")
            
            # Update status to error
            try:
                error_status = f"error: {str(e)}"
                self._update_next_run(schedule_id, datetime.now(), error_status)
                
                # Store error log
                with get_db() as db:
                    log_entry = DbScheduleLog(
                        schedule_id=schedule_id,
                        execution_time=datetime.now(),
                        status="error",
                        message=str(e)
                    )
                    db.add(log_entry)
                    db.commit()
            except:
                pass
                
            return False
    
    async def start_scheduler(self):
        """Start the background scheduler task"""
        if self.running_task is None or self.running_task.done():
            self.running_task = asyncio.create_task(self._scheduler_task())
            logger.info("Started scheduler task")
    
    # Set to keep track of schedules currently being executed
    _currently_executing = set()
    _active_tasks = set()  # Keep track of active tasks for proper cleanup
    
    async def _scheduler_task(self):
        """Background task that checks and executes scheduled jobs"""
        logger.info("Scheduler task started")
        
        while True:
            try:
                # Get all enabled schedules
                with get_db() as db:
                    schedules = db.query(DbSchedule).filter(
                        DbSchedule.enabled == True
                    ).all()
                    
                    # Use UTC time for consistent comparison
                    now = datetime.now()
                    
                    # Clean up completed tasks
                    self._active_tasks = {task for task in self._active_tasks if not task.done()}
                    
                    for schedule in schedules:
                        # Check if it's time to run the schedule, not already running in DB,
                        # and not currently being executed by another task
                        if (schedule.next_run <= now and 
                            schedule.last_run_status != "running" and
                            schedule.id not in self._currently_executing):
                            
                            logger.info(f"Schedule {schedule.id} is due to run")
                            
                            # Mark as being executed to prevent race conditions
                            self._currently_executing.add(schedule.id)
                            
                            # Execute in a separate task to avoid blocking
                            task = asyncio.create_task(
                                self._execute_and_cleanup(schedule.id)
                            )
                            # Keep track of the task
                            self._active_tasks.add(task)
                            
                            # Add a small delay to avoid overloading
                            await asyncio.sleep(2)
                
                # Sleep for a while before checking again
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except asyncio.CancelledError:
                logger.info("Scheduler task cancelled")
                # Clean up any open sessions before exiting
                from app.database.session import close_thread_sessions
                close_thread_sessions()
                break
            except Exception as e:
                logger.error(f"Error in scheduler task: {e}")
                logger.exception("Exception details:")
                await asyncio.sleep(60)  # Longer sleep on error
    
    async def shutdown(self):
        """Gracefully shut down the scheduler"""
        logger.info("Shutting down scheduler...")
        
        # Cancel the main scheduler task
        if self.running_task and not self.running_task.done():
            self.running_task.cancel()
            try:
                await self.running_task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(f"Error cancelling scheduler task: {e}")
        
        # Cancel any active schedule tasks
        active_tasks = list(self._active_tasks)
        if active_tasks:
            logger.info(f"Cancelling {len(active_tasks)} active schedule tasks")
            for task in active_tasks:
                if not task.done():
                    task.cancel()
            
            # Wait for all tasks to complete or be cancelled
            if active_tasks:
                try:
                    await asyncio.gather(*active_tasks, return_exceptions=True)
                except Exception as e:
                    logger.error(f"Error waiting for tasks to cancel: {e}")
        
        # Update any running schedules to be paused
        try:
            with get_db() as db:
                running_schedules = db.query(DbSchedule).filter(
                    DbSchedule.last_run_status == "running"
                ).all()
                
                for schedule in running_schedules:
                    schedule.last_run_status = "interrupted"
                    # Log interruption
                    log_entry = DbScheduleLog(
                        schedule_id=schedule.id,
                        execution_time=datetime.now(),
                        status="interrupted",
                        message="Execution interrupted by application shutdown"
                    )
                    db.add(log_entry)
                
                db.commit()
        except Exception as e:
            logger.error(f"Error updating running schedules: {e}")
        
        # Clear tracking sets
        self._currently_executing.clear()
        self._active_tasks.clear()
        
        # Make sure to close any open database sessions
        from app.database.session import close_thread_sessions
        close_thread_sessions()
        
        logger.info("Scheduler shutdown complete")


# Create a singleton instance
schedule_manager = ScheduleManager()