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

    def _run_docker_cli(self, args: list[str], timeout: int = 30) -> tuple[int, str, str]:
        """Run a docker CLI command and return (code, stdout, stderr)."""
        result = subprocess.run(
            ["docker", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()

    async def check_compilers_status(self) -> Dict[str, Any]:
        """Check availability of compiler images and validate tools via test commands."""
        docker_available = await self.check_docker_available()
        if not docker_available:
            return {
                "docker_available": False,
                "compilers": {},
                "message": "Docker is not available",
            }

        test_commands = {
            CompilerType.ARDUINO: "arduino-cli version",
            CompilerType.TI_ARM: "arm-none-eabi-gcc --version",
            CompilerType.ESP32: "idf.py --version",
        }

        results: Dict[str, Any] = {}
        for compiler, image_name in self._container_images.items():
            command = test_commands.get(compiler, "")
            if not command:
                results[compiler.value] = {
                    "available": False,
                    "message": "No test command configured",
                }
                continue

            exit_code, stdout, stderr = self._run_docker_cli(
                ["run", "--rm", image_name, "sh", "-lc", command],
                timeout=60,
            )
            results[compiler.value] = {
                "available": exit_code == 0,
                "message": stdout or stderr or "No output",
            }

        return {
            "docker_available": True,
            "compilers": results,
            "message": "Compiler checks completed",
        }
    
    async def pull_compiler_image(self, compiler: CompilerType) -> bool:
        """Pull the compiler Docker image if not present"""
        try:
            image_name = self._container_images.get(compiler)
            
            if not image_name:
                return False

            if shutil.which("docker") is None:
                return False

            inspect_code, _, _ = self._run_docker_cli(["image", "inspect", image_name], timeout=10)
            if inspect_code != 0:
                pull_code, _, pull_err = self._run_docker_cli(["pull", image_name], timeout=600)
                if pull_code != 0:
                    print(f"Error pulling image for {compiler}: {pull_err}")
                    return False

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

        # Normalize Arduino sketches to required folder/file naming
        files_to_write = files
        main_file = request.main_file
        if request.compiler == CompilerType.ARDUINO:
            sketch_dir = "sketch"
            sketch_file = f"{sketch_dir}/sketch.ino"
            main_content = files.get(request.main_file)
            if main_content is None:
                return CompileResult(
                    status=CompilationStatus.ERROR,
                    output=f"Main file {request.main_file} not found",
                    errors=[f"Main file {request.main_file} not found"],
                    compile_time_ms=0,
                )

            normalized_files: Dict[str, str] = {}
            for path, content in files.items():
                if path == request.main_file:
                    continue
                normalized_files[f"{sketch_dir}/{path}"] = content
            normalized_files[sketch_file] = main_content

            files_to_write = normalized_files
            main_file = sketch_dir
            
        compile_base = os.environ.get("COMPILE_WORKDIR", "/compile_tmp")
        os.makedirs(compile_base, exist_ok=True)
        temp_dir = tempfile.mkdtemp(prefix="cubot_compile_", dir=compile_base)
        
        try:
            # Write files to temp directory
            await self._write_files_to_temp(temp_dir, files_to_write)
            
            # Run compilation in container
            result = await self._run_compilation(
                image_name=image_name,
                compiler=request.compiler,
                source_dir=temp_dir,
                main_file=main_file,
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
        # Build the compile command based on compiler type
        command = self._build_compile_command(compiler, main_file, build_flags)
        
        try:
            if shutil.which("docker") is None:
                return CompileResult(
                    status=CompilationStatus.ERROR,
                    output="Docker CLI not found.",
                    errors=["Docker CLI not available"],
                    compile_time_ms=0,
                )

            # Translate the container-internal path to the host path for
            # the -v mount so the compiler container can access the files.
            host_base = os.environ.get("COMPILE_WORKDIR_HOST",
                                       os.environ.get("COMPILE_WORKDIR", "/compile_tmp"))
            host_source_dir = source_dir.replace(
                os.environ.get("COMPILE_WORKDIR", "/compile_tmp"),
                host_base,
                1,
            )

            docker_args = [
                "run",
                "--rm",
                "--network",
                "none",
                "-m",
                "512m",
                "--cpus",
                "0.5",
                "--entrypoint",
                "sh",
                "-v",
                f"{host_source_dir}:/src",
                "-w",
                "/src",
                image_name,
                "-lc",
                command,
            ]

            exit_code, stdout, stderr = self._run_docker_cli(
                docker_args,
                timeout=settings.COMPILE_TIMEOUT,
            )

            logs = "\n".join([text for text in [stdout, stderr] if text])
            
            # Check for output binary
            binary_data = None
            binary_name = None
            hex_output = None
            output_path = self._get_output_path(compiler, main_file)
            full_output_path = os.path.join(source_dir, output_path)
            
            if os.path.exists(full_output_path):
                with open(full_output_path, "rb") as f:
                    binary_data = f.read()
                binary_name = os.path.basename(output_path)
                # If it's a .hex file, also read as text for simulation
                if output_path.endswith('.hex'):
                    with open(full_output_path, "r") as f:
                        hex_output = f.read()
            
            if exit_code == 0:
                return CompileResult(
                    status=CompilationStatus.SUCCESS,
                    output=logs,
                    errors=[],
                    binary_data=binary_data,
                    binary_name=binary_name,
                    hex_output=hex_output,
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
            sketch_path = f"/src/{main_file}" if main_file else "/src"
            return f"arduino-cli compile --fqbn arduino:avr:uno --output-dir /src/build {flags} {sketch_path}"
        
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
            # Get the .ino filename from the sketch folder
            return f"build/{main_name}.ino.hex"
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
