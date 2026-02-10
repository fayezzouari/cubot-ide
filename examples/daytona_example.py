"""
Example: Using Daytona SDK for Sandboxed Code Execution

This example demonstrates how to use the Daytona SDK to execute
Python code in isolated sandboxes.
"""

from daytona import Daytona, DaytonaConfig

# Initialize Daytona client
# For local sandboxes (no API key needed)
config = DaytonaConfig()
daytona = Daytona(config)

# For Daytona Cloud (requires API key)
# config = DaytonaConfig(api_key="your-api-key")
# daytona = Daytona(config)

# Create a sandbox
print("Creating sandbox...")
sandbox = daytona.create()
print("Sandbox created!")

# Example 1: Simple Hello World
print("\n=== Example 1: Hello World ===")
response = sandbox.process.code_run('print("Hello from Daytona sandbox!")')
if response.exit_code == 0:
    print(f"Output: {response.result}")
else:
    print(f"Error: {response.result}")

# Example 2: Math calculations
print("\n=== Example 2: Math Calculations ===")
code = """
import math
result = math.sqrt(16) + math.pi
print(f"Result: {result:.2f}")
"""
response = sandbox.process.code_run(code)
if response.exit_code == 0:
    print(f"Output: {response.result}")
else:
    print(f"Error: {response.result}")

# Example 3: Component simulation (temperature sensor)
print("\n=== Example 3: Temperature Sensor Simulation ===")
sensor_code = """
import random
import json

def init(context):
    return {
        "state": {
            "temperature": 25.0,
            "last_update": 0
        }
    }

def update(context):
    time = context["time"]
    temp = 25.0 + random.uniform(-2, 2)
    
    return {
        "state": {
            "temperature": temp,
            "last_update": time
        },
        "pin_outputs": {
            "OUT": int(temp * 10)
        },
        "serial": f"Temp: {temp:.1f}°C"
    }

# Simulate one update
context = {
    "time": 1.0,
    "pin_values": {},
    "state": {"temperature": 25.0, "last_update": 0},
    "properties": {}
}

result = update(context)
print(json.dumps(result, indent=2))
"""

response = sandbox.process.code_run(sensor_code)
if response.exit_code == 0:
    print(f"Output:\n{response.result}")
else:
    print(f"Error: {response.result}")

# Example 4: Error handling
print("\n=== Example 4: Error Handling ===")
error_code = """
# This will cause an error
result = 1 / 0
"""
response = sandbox.process.code_run(error_code)
if response.exit_code != 0:
    print(f"Caught error (as expected): {response.result}")

# Sandbox cleanup is automatic when the script ends
print("\n=== Done! ===")
print("Sandbox will be automatically cleaned up.")
