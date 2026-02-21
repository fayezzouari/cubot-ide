from fastapi import APIRouter, HTTPException, status, Response
from typing import List, Optional

from models.compilation import CompileRequest, CompilationResponse, CompileExplainRequest, CompileExplainResponse, UploadRequest, UploadResponse
from models.file import CompilerType
from services.compiler_service import compiler_service
from services.file_service import file_service
from services.ai_service import ai_service

router = APIRouter(prefix="/compile", tags=["compilation"])


@router.post("/", response_model=CompilationResponse)
async def compile_project(request: CompileRequest):
    """
    Compile project files using the specified compiler
    
    The request should include:
    - compiler: The target compiler (arduino, ti_arm, esp32)
    - file_ids: List of file IDs to include in compilation
    - main_file: The main entry file path
    - build_flags: Optional compiler flags
    """
    # Get all files for compilation
    files_dict = {}
    
    for file_id in request.file_ids:
        file = await file_service.get_file(file_id)
        if not file:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File with id {file_id} not found"
            )
        files_dict[file.path] = file.content
    
    if not files_dict:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files provided for compilation"
        )
    
    # Verify main file exists
    if request.main_file not in files_dict:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Main file {request.main_file} not found in provided files"
        )
    
    # Compile the code
    result = await compiler_service.compile_code(request, files_dict)
    
    return CompilationResponse(
        status=result.status,
        success=result.status.value == "success",
        output=result.output,
        errors=result.errors,
        binary_name=result.binary_name,
        hex_output=result.hex_output,
        compile_time_ms=result.compile_time_ms,
        has_binary=result.binary_data is not None,
    )


@router.post("/download-binary/{project_id}")
async def compile_and_download(
    project_id: str,
    compiler: CompilerType,
    main_file: str,
    build_flags: Optional[List[str]] = None,
):
    """
    Compile project and return the binary file for download
    """
    # Get all project files
    files = await file_service.get_files_by_project(project_id)
    
    if not files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No files found in project"
        )
    
    files_dict = {f.path: f.content for f in files}
    
    if main_file not in files_dict:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Main file {main_file} not found in project"
        )
    
    # Create compile request
    request = CompileRequest(
        compiler=compiler,
        file_ids=[f.id for f in files],
        main_file=main_file,
        build_flags=build_flags,
    )
    
    # Compile
    result = await compiler_service.compile_code(request, files_dict)
    
    if result.binary_data is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Compilation failed: {result.output}"
        )
    
    # Return binary as downloadable file
    return Response(
        content=result.binary_data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename={result.binary_name}"
        }
    )


@router.get("/compilers")
async def list_compilers():
    """List available compilers"""
    return {
        "compilers": [
            {
                "id": CompilerType.ARDUINO.value,
                "name": "Arduino",
                "description": "Arduino AVR compiler for Arduino boards",
                "extensions": [".ino", ".cpp", ".c", ".h"],
            },
            {
                "id": CompilerType.TI_ARM.value,
                "name": "TI ARM",
                "description": "ARM GCC compiler for TI microcontrollers",
                "extensions": [".c", ".cpp", ".h", ".s"],
            },
            {
                "id": CompilerType.ESP32.value,
                "name": "ESP32",
                "description": "ESP-IDF compiler for ESP32 boards",
                "extensions": [".c", ".cpp", ".h"],
            },
        ]
    }


@router.get("/ports")
async def list_serial_ports():
    """
    List available serial ports and rank them by likelihood of being an Arduino.

    Uses pyserial's list_ports to inspect USB vendor/product IDs and
    descriptions. Known Arduino VIDs are scored higher so the UI can
    pre-select the most likely port.
    """
    import serial.tools.list_ports as lp
    import sys

    # Known USB Vendor IDs associated with Arduino-compatible boards
    ARDUINO_VIDS = {
        0x2341: "Arduino LLC",
        0x1A86: "CH340 (clone)",  # very common on cheap Nanos
        0x0403: "FTDI",           # older Arduinos / Pro Mini adapters
        0x10C4: "CP210x",         # another common USB-serial chip
        0x16C0: "Teensy / VUSB",
    }

    ports = []
    for p in lp.comports():
        vid = p.vid  # integer or None
        score = 0
        hint = ""

        if vid in ARDUINO_VIDS:
            score = 2
            hint = ARDUINO_VIDS[vid]
        elif p.description and any(
            kw in p.description.lower()
            for kw in ("arduino", "ch340", "ftdi", "cp210", "usb serial", "usb-serial")
        ):
            score = 1
            hint = p.description

        ports.append({
            "port": p.device,
            "description": p.description or "",
            "manufacturer": p.manufacturer or "",
            "hint": hint,
            "score": score,
        })

    # Sort: highest score first, then alphabetically
    ports.sort(key=lambda x: (-x["score"], x["port"]))

    # Platform-specific fallback default
    if sys.platform.startswith("win"):
        fallback = "COM3"
    elif sys.platform == "darwin":
        fallback = "/dev/cu.usbmodem14101"
    else:
        fallback = "/dev/ttyACM0"

    return {
        "ports": ports,
        "suggested": ports[0]["port"] if ports else fallback,
        "fallback": fallback,
    }


@router.get("/status")
async def check_compiler_status():
    """Check if Docker and compilers are available"""
    docker_available = await compiler_service.check_docker_available()
    
    return {
        "docker_available": docker_available,
        "message": "Docker is running" if docker_available else "Docker is not available"
    }


@router.post("/upload", response_model=UploadResponse)
async def upload_firmware(request: UploadRequest):
    """
    Compile the project and upload the firmware to the connected Arduino board.

    Requires:
    - compiler: arduino (only Arduino is supported for direct upload)
    - file_ids: list of file IDs to compile
    - main_file: entry-point file path
    - port: serial port the board is connected to (e.g. /dev/ttyACM0)
    - fqbn: fully-qualified board name (default: arduino:avr:uno)
    """
    files_dict: dict = {}
    for file_id in request.file_ids:
        file = await file_service.get_file(file_id)
        if not file:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File with id {file_id} not found",
            )
        files_dict[file.path] = file.content

    if not files_dict:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files provided for upload",
        )

    if request.main_file not in files_dict:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Main file {request.main_file} not found in provided files",
        )

    result = await compiler_service.upload_firmware(request, files_dict)
    return UploadResponse(
        success=result["success"],
        output=result["output"],
        errors=result["errors"],
    )


@router.post("/explain", response_model=CompileExplainResponse)
async def explain_compile_logs(request: CompileExplainRequest):
    """Explain compile logs with a concise AI summary"""
    explanation = await ai_service.explain_compile_logs(
        project_id=request.project_id,
        logs=request.logs,
        errors=request.errors,
        compiler=request.compiler.value if request.compiler else None,
    )
    return CompileExplainResponse(explanation=explanation)


@router.get("/compilers/status")
async def check_compilers_status():
    """Check compiler images and tools using test scripts"""
    return await compiler_service.check_compilers_status()
