import asyncio
import tempfile
import os
import shutil
import subprocess
from typing import Optional, Dict, Any
from datetime import datetime
import docker
from docker.errors import DockerException
from docker.errors import ContainerError, ImageNotFound, APIError

from core.config import settings
from models.file import CompilerType
from models.compilation import CompilationStatus, CompileRequest, CompileResult


class CompilerService:
    """Service for compiling code using Docker containers"""
    
    def __init__(self):
        self.client: Optional[docker.DockerClient] = None
        self._container_images = {
            CompilerType.ARDUINO: settings.ARDUINO_IMAGE,
            CompilerType.TI_ARM: settings.TI_ARM_IMAGE,
            CompilerType.ESP32: settings.ESP32_IMAGE,
        }
    
    def _get_client(self) -> docker.DockerClient:
        """Get Docker client (lazy initialization)"""
        if self.client is None:
            try:
                docker_host = os.environ.get("DOCKER_HOST")
                if docker_host and docker_host.startswith("http+docker"):
                    docker_host = "unix:///var/run/docker.sock"
                if docker_host:
                    self.client = docker.DockerClient(base_url=docker_host)
                else:
                    self.client = docker.from_env()
            except DockerException:
                # Fallback to default local socket
                self.client = docker.DockerClient(base_url="unix:///var/run/docker.sock")
        return self.client
    
    async def check_docker_available(self) -> bool:
        """Check if Docker is available"""
        try:
            if shutil.which("docker") is None:
                return False
            result = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return True
            print(f"Docker CLI unavailable: {result.stderr.strip()}")
        except Exception as cli_error:
            print(f"Docker CLI check failed: {cli_error}")
        return False
    
    async def pull_compiler_image(self, compiler: CompilerType) -> bool:
        """Pull the compiler Docker image if not present"""
        try:
            client = self._get_client()
            image_name = self._container_images.get(compiler)
            
            if not image_name:
                return False
            
            try:
                client.images.get(image_name)
            except ImageNotFound:
                client.images.pull(image_name)
            
            return True
        except Exception as e:
            print(f"Error pulling image for {compiler}: {e}")
            return False
    
    async def compile_code(
        self,
        request: CompileRequest,
        files: Dict[str, str]
    ) -> CompileResult:
        """
        Compile code using the appropriate Docker container
        
        Args:
            request: The compilation request with compiler type and settings
            files: Dictionary mapping file paths to their contents
        
        Returns:
            CompileResult with status, output, and optional binary
        """
        start_time = datetime.utcnow()
        
        # Check Docker availability
        if not await self.check_docker_available():
            return CompileResult(
                status=CompilationStatus.ERROR,
                output="Docker is not available. Please ensure Docker is running.",
                errors=["Docker service unavailable"],
                compile_time_ms=0,
            )
        
        # Get compiler image
        image_name = self._container_images.get(request.compiler)
        if not image_name:
            return CompileResult(
                status=CompilationStatus.ERROR,
                output=f"Unsupported compiler: {request.compiler}",
                errors=[f"No image configured for {request.compiler}"],
                compile_time_ms=0,
            )
        
        # Create temporary directory for compilation
        temp_dir = tempfile.mkdtemp(prefix="cubot_compile_")
        
        try:
            # Write files to temp directory
            await self._write_files_to_temp(temp_dir, files)
            
            # Run compilation in container
            result = await self._run_compilation(
                image_name=image_name,
                compiler=request.compiler,
                source_dir=temp_dir,
                main_file=request.main_file,
                build_flags=request.build_flags,
            )
            
            # Calculate compile time
            end_time = datetime.utcnow()
            compile_time_ms = int((end_time - start_time).total_seconds() * 1000)
            result.compile_time_ms = compile_time_ms
            
            return result
            
        except asyncio.TimeoutError:
            return CompileResult(
                status=CompilationStatus.TIMEOUT,
                output=f"Compilation timed out after {settings.COMPILE_TIMEOUT} seconds",
                errors=["Compilation timeout"],
                compile_time_ms=settings.COMPILE_TIMEOUT * 1000,
            )
        except Exception as e:
            return CompileResult(
                status=CompilationStatus.ERROR,
                output=str(e),
                errors=[str(e)],
                compile_time_ms=0,
            )
        finally:
            # Cleanup temp directory
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    async def _write_files_to_temp(
        self,
        temp_dir: str,
        files: Dict[str, str]
    ) -> None:
        """Write files to temporary directory"""
        for file_path, content in files.items():
            # Create subdirectories if needed
            full_path = os.path.join(temp_dir, file_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            with open(full_path, "w") as f:
                f.write(content)
    
    async def _run_compilation(
        self,
        image_name: str,
        compiler: CompilerType,
        source_dir: str,
        main_file: str,
        build_flags: Optional[list] = None,
    ) -> CompileResult:
        """Run the compilation in a Docker container"""
        client = self._get_client()
        
        # Build the compile command based on compiler type
        command = self._build_compile_command(compiler, main_file, build_flags)
        
        try:
            # Pull image if not present
            try:
                client.images.get(image_name)
            except ImageNotFound:
                client.images.pull(image_name)
            
            # Run container
            container = client.containers.run(
                image_name,
                command=command,
                volumes={
                    source_dir: {"bind": "/src", "mode": "rw"}
                },
                working_dir="/src",
                detach=True,
                mem_limit="512m",
                cpu_period=100000,
                cpu_quota=50000,  # 50% CPU
                network_disabled=True,
            )
            
            # Wait for container to finish with timeout
            try:
                result = container.wait(timeout=settings.COMPILE_TIMEOUT)
                exit_code = result.get("StatusCode", 1)
                logs = container.logs().decode("utf-8")
            finally:
                container.remove(force=True)
            
            # Check for output binary
            binary_data = None
            binary_name = None
            output_path = self._get_output_path(compiler, main_file)
            full_output_path = os.path.join(source_dir, output_path)
            
            if os.path.exists(full_output_path):
                with open(full_output_path, "rb") as f:
                    binary_data = f.read()
                binary_name = os.path.basename(output_path)
            
            if exit_code == 0:
                return CompileResult(
                    status=CompilationStatus.SUCCESS,
                    output=logs,
                    errors=[],
                    binary_data=binary_data,
                    binary_name=binary_name,
                    compile_time_ms=0,
                )
            else:
                # Parse errors from logs
                errors = self._parse_errors(logs, compiler)
                return CompileResult(
                    status=CompilationStatus.ERROR,
                    output=logs,
                    errors=errors,
                    compile_time_ms=0,
                )
                
        except ContainerError as e:
            return CompileResult(
                status=CompilationStatus.ERROR,
                output=str(e),
                errors=[str(e)],
                compile_time_ms=0,
            )
        except APIError as e:
            return CompileResult(
                status=CompilationStatus.ERROR,
                output=f"Docker API error: {e}",
                errors=[str(e)],
                compile_time_ms=0,
            )
    
    def _build_compile_command(
        self,
        compiler: CompilerType,
        main_file: str,
        build_flags: Optional[list] = None,
    ) -> str:
        """Build the compilation command for each compiler type"""
        flags = " ".join(build_flags or [])
        
        if compiler == CompilerType.ARDUINO:
            # Arduino CLI compile command
            return f"arduino-cli compile --fqbn arduino:avr:uno {flags} /src"
        
        elif compiler == CompilerType.TI_ARM:
            # TI ARM compiler command
            main_name = os.path.splitext(main_file)[0]
            return f"arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb {flags} -o /src/{main_name}.elf /src/{main_file}"
        
        elif compiler == CompilerType.ESP32:
            # ESP-IDF build command
            return f"idf.py build {flags}"
        
        return "echo 'Unknown compiler'"
    
    def _get_output_path(self, compiler: CompilerType, main_file: str) -> str:
        """Get the expected output binary path"""
        main_name = os.path.splitext(main_file)[0]
        
        if compiler == CompilerType.ARDUINO:
            return f"build/arduino.avr.uno/{main_name}.hex"
        elif compiler == CompilerType.TI_ARM:
            return f"{main_name}.elf"
        elif compiler == CompilerType.ESP32:
            return f"build/{main_name}.bin"
        
        return "output.bin"
    
    def _parse_errors(self, logs: str, compiler: CompilerType) -> list:
        """Parse error messages from compiler output"""
        errors = []
        lines = logs.split("\n")
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Common error patterns
            if "error:" in line.lower():
                errors.append(line)
            elif "undefined reference" in line.lower():
                errors.append(line)
            elif "fatal:" in line.lower():
                errors.append(line)
        
        return errors if errors else [logs]


compiler_service = CompilerService()
