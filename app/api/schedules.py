from fastapi import APIRouter, HTTPException, Path, BackgroundTasks, Depends
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from croniter import croniter
from datetime import datetime

from app.models import ScheduleConfig, ScheduleResponse, ScheduleLogEntry
from app.database.session import get_db
from app.database.models import Schedule, ScheduleLog
from app.cron.jobs import schedule_manager  # We'll still use this for actual scheduling logic

router = APIRouter()


@router.post("/", response_model=ScheduleResponse, summary="Create a new schedule")
async def create_schedule(config: ScheduleConfig, db: Session = Depends(get_db)):
    """
    Create a new scheduled job for downloading movies.
    
    - **cron_expression**: Cron expression for scheduling (e.g., "0 0 * * *" for daily at midnight)
    - **search_params**: Search parameters for finding movies
    - **quality**: Desired quality for downloads
    - **max_downloads**: Maximum number of movies to download per execution
    - **enabled**: Whether the schedule is enabled
    
    ###Create a Scheduled Download example
    
    ```bash
    curl -X POST "http://localhost:8000/api/v1/schedules/" \
     -H "Content-Type: application/json" \
     -d '{
           "cron_expression": "0 2 * * *",
           "search_params": {
             "order_by": "rating",
             "year": 2024
           },
           "quality": "1080p",
           "max_downloads": 1,
           "enabled": true
         }'
    ```
    """
    try:
        # Calculate next run time
        cron = croniter(config.cron_expression, datetime.now())
        next_run = cron.get_next(datetime)
        
        # Create new schedule using our model's create method
        new_schedule: Schedule = Schedule.create(
            db,
            name=config.name,
            cron_expression=config.cron_expression,
            search_params=config.search_params.model_dump(),
            quality=config.quality,
            max_downloads=config.max_downloads,
            enabled=config.enabled,
            next_run=next_run
        )
        
        # Add a log entry for creation
        new_schedule.add_log(
            db,
            status="created",
            message=f"Schedule created - next run: {next_run}"
        )
        
        # Call the schedule manager to register the schedule
        schedule_id = schedule_manager.add_schedule(config)
        
        # Return the schedule response
        return new_schedule.to_response()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=List[ScheduleResponse], summary="List all schedules")
async def list_schedules(db: Session = Depends(get_db)):
    """
    List all scheduled jobs.
    """
    # Use the model's get_all method
    schedules: List[Schedule] = Schedule.get_all(db)
    
    # Convert to response models
    return [schedule.to_response() for schedule in schedules]


@router.get("/{schedule_id}", response_model=ScheduleResponse, summary="Get a schedule")
async def get_schedule(
    schedule_id: str = Path(..., description="ID of the schedule"),
    db: Session = Depends(get_db)
):
    """
    Get details of a specific scheduled job.
    """
    # Use the model's get_by_id method
    schedule: Schedule = Schedule.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Convert to response model
    return schedule.to_response()


@router.put("/{schedule_id}", response_model=ScheduleResponse, summary="Update a schedule")
async def update_schedule(
    config: ScheduleConfig,
    schedule_id: str = Path(..., description="ID of the schedule"),
    db: Session = Depends(get_db)
):
    """
    Update an existing scheduled job.
    """
    # Get the schedule
    schedule: Schedule = Schedule.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Calculate next run time
    cron = croniter(config.cron_expression, datetime.now())
    next_run = cron.get_next(datetime)
    
    # Update the schedule
    schedule.update_from_config(config, next_run, db)
    
    # Add a log entry for update
    schedule.add_log(
        db,
        status="updated",
        message=f"Schedule updated - next run: {next_run}"
    )
    
    # Call the schedule manager to update the schedule
    success = schedule_manager.update_schedule(schedule_id, config)
    if not success:
        # This should not happen since we already found the schedule
        raise HTTPException(status_code=500, detail="Failed to update schedule in scheduler")
    
    # Return the updated schedule
    return schedule.to_response()


@router.delete("/{schedule_id}", response_model=Dict[str, Any], summary="Delete a schedule")
async def delete_schedule(
    schedule_id: str = Path(..., description="ID of the schedule"),
    db: Session = Depends(get_db)
):
    """
    Delete a scheduled job.
    """
    # Get the schedule
    schedule: Schedule = Schedule.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Call the schedule manager to delete the schedule
    success = schedule_manager.delete_schedule(schedule_id)
    if not success:
        # This should not happen since we already found the schedule
        raise HTTPException(status_code=500, detail="Failed to delete schedule from scheduler")
    
    # Delete the schedule from the database
    schedule.delete(db)
    
    return {"success": True, "schedule_id": schedule_id}


@router.post("/{schedule_id}/run", response_model=Dict[str, Any], summary="Run a schedule immediately")
async def run_schedule(
    schedule_id: str = Path(..., description="ID of the schedule"),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """
    Execute a scheduled job immediately.
    """
    # Get the schedule
    schedule: Schedule = Schedule.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Add a log entry for manual run
    schedule.add_log(
        db,
        status="manual_run",
        message="Manual execution requested"
    )
    
    # Update status to running
    schedule.update(db, last_run_status="running")
    
    if background_tasks:
        background_tasks.add_task(schedule_manager.execute_schedule, schedule_id)
        return {"success": True, "message": "Schedule execution started in background"}
    else:
        # Run in the current task (will block until completion)
        success = await schedule_manager.execute_schedule(schedule_id)
        if not success:
            raise HTTPException(status_code=500, detail="Schedule execution failed")
        
        return {"success": True, "message": "Schedule executed successfully"}


@router.get("/{schedule_id}/logs", response_model=List[ScheduleLogEntry], summary="Get schedule execution logs")
async def get_schedule_logs(
    schedule_id: str = Path(..., description="ID of the schedule"),
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """
    Get the execution logs for a specific schedule.
    """
    # Get the schedule
    schedule: Schedule = Schedule.get_by_id(db, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Get recent logs using the model's class method
    logs = ScheduleLog.get_recent_logs(db, schedule_id, limit)
    
    return logs