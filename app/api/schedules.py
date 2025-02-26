from fastapi import APIRouter, HTTPException, Path, BackgroundTasks
from typing import List, Dict, Any

from app.models import ScheduleConfig, ScheduleResponse
from app.cron.jobs import schedule_manager

router = APIRouter()


@router.post("/", response_model=ScheduleResponse, summary="Create a new schedule")
async def create_schedule(config: ScheduleConfig):
    """
    Create a new scheduled job for downloading movies.
    
    - **cron_expression**: Cron expression for scheduling (e.g., "0 0 * * *" for daily at midnight)
    - **search_params**: Search parameters for finding movies
    - **quality**: Desired quality for downloads
    - **max_downloads**: Maximum number of movies to download per execution
    - **enabled**: Whether the schedule is enabled
    """
    try:
        schedule_id = schedule_manager.add_schedule(config)
        return schedule_manager.get_schedule(schedule_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=List[ScheduleResponse], summary="List all schedules")
async def list_schedules():
    """
    List all scheduled jobs.
    """
    schedules = schedule_manager.get_all_schedules()
    return schedules


@router.get("/{schedule_id}", response_model=ScheduleResponse, summary="Get a schedule")
async def get_schedule(schedule_id: str = Path(..., description="ID of the schedule")):
    """
    Get details of a specific scheduled job.
    """
    schedule = schedule_manager.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    return schedule


@router.put("/{schedule_id}", response_model=ScheduleResponse, summary="Update a schedule")
async def update_schedule(
    config: ScheduleConfig,
    schedule_id: str = Path(..., description="ID of the schedule")
):
    """
    Update an existing scheduled job.
    """
    success = schedule_manager.update_schedule(schedule_id, config)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    return schedule_manager.get_schedule(schedule_id)


@router.delete("/{schedule_id}", response_model=Dict[str, Any], summary="Delete a schedule")
async def delete_schedule(schedule_id: str = Path(..., description="ID of the schedule")):
    """
    Delete a scheduled job.
    """
    success = schedule_manager.delete_schedule(schedule_id)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule not found or deletion failed")
    
    return {"success": True, "schedule_id": schedule_id}


@router.post("/{schedule_id}/run", response_model=Dict[str, Any], summary="Run a schedule immediately")
async def run_schedule(
    schedule_id: str = Path(..., description="ID of the schedule"),
    background_tasks: BackgroundTasks = None
):
    """
    Execute a scheduled job immediately.
    """
    schedule = schedule_manager.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    if background_tasks:
        background_tasks.add_task(schedule_manager.execute_schedule, schedule_id)
        return {"success": True, "message": "Schedule execution started in background"}
    else:
        # Run in the current task (will block until completion)
        success = await schedule_manager.execute_schedule(schedule_id)
        if not success:
            raise HTTPException(status_code=500, detail="Schedule execution failed")
        
        return {"success": True, "message": "Schedule executed successfully"}