"""
Inverse Kinematics solver matching the Three.js 3D model exactly
"""
import math
from typing import Tuple, List, Optional


class ArmKinematics:
    """
    Arm structure matching the Three.js model hierarchy:
    - Joint 1 at (0, 0.3, 0): Rotates Y-axis (base rotation)
      - Joint 2 at (0, 0.5, 0) relative: Rotates Z-axis (shoulder)
        - Link 1: extends +Y by 1.5 (center at 0.75)
        - Joint 3 at (0, 1.5, 0) relative: Rotates Z-axis (elbow)
          - Link 2: extends +Y by 1.2 (center at 0.6)
          - Joint 4 at (0, 1.2, 0) relative: Rotates X-axis (wrist rotation)
            - Joint 5 at (0, 0.3, 0) relative: Rotates Z-axis (wrist bend)
              - End effector: extends +Y by ~0.5
    """
    
    # Vertical offsets in the hierarchy
    BASE_TO_J1 = 0.3
    J1_TO_J2 = 0.5
    J2_TO_J3 = 1.5  # Link 1 length
    J3_TO_J4 = 1.2  # Link 2 length
    J4_TO_J5 = 0.3
    J5_TO_END = 0.5  # End effector length
    
    @staticmethod
    def solve_ik(target_x: float, target_y: float, target_z: float) -> Optional[List[float]]:
        """
        Solve IK for target position.
        Uses improved algorithm that searches for the best elbow configuration.
        """
        # Joint 1: Base rotation towards target (rotation around Y-axis)
        # With coordinate system: x = horizontal * sin(j1), z = -horizontal * cos(j1)
        # For target (x, z): horizontal * sin(j1) = x, -horizontal * cos(j1) = z
        # Therefore: j1 = atan2(x, -z)
        horizontal_dist = math.sqrt(target_x**2 + target_z**2)
        if horizontal_dist < 0.001:
            joint1 = 0
        else:
            joint1 = math.degrees(math.atan2(target_x, -target_z))
        
        # Height of shoulder joint (J2) in world space
        shoulder_height = ArmKinematics.BASE_TO_J1 + ArmKinematics.J1_TO_J2
        
        # Target relative to shoulder in the arm's plane
        target_y_rel = target_y - shoulder_height
        
        # Arm link lengths
        L1 = ArmKinematics.J2_TO_J3  # Upper arm: 1.5
        L2_effective = (ArmKinematics.J3_TO_J4 + 
                       ArmKinematics.J4_TO_J5 + 
                       ArmKinematics.J5_TO_END)  # Forearm + wrist + end: 2.0
        
        # Distance from shoulder to target in the arm's plane
        reach_dist = math.sqrt(horizontal_dist**2 + target_y_rel**2)
        
        # Check if reachable
        max_reach = L1 + L2_effective
        if reach_dist > max_reach or reach_dist < 0.1:
            return None
        
        # Additional reachability checks
        if target_y < 0.5:  # Below reasonable height
            return None
        
        if horizontal_dist < 0.5 and target_y < shoulder_height:  # Inside base
            return None
        
        # Search for best solution by trying different elbow and shoulder angles
        # This is more robust than analytical solution which can pick wrong configuration
        best_error = float('inf')
        best_solution = None
        
        # Coarse search first
        for j2 in range(30, 131, 10):  # Shoulder: 30° to 130° in 10° steps
            for j3 in range(-140, -59, 10):  # Elbow: -140° to -60° in 10° steps
                solution = [joint1, float(j2), float(j3), 0.0, 0.0, 0.0]
                actual = ArmKinematics.forward_kinematics(solution)
                error = math.sqrt(
                    (actual[0] - target_x)**2 + 
                    (actual[1] - target_y)**2 + 
                    (actual[2] - target_z)**2
                )
                if error < best_error:
                    best_error = error
                    best_solution = solution
        
        # Fine search around best solution
        if best_solution:
            j2_best = best_solution[1]
            j3_best = best_solution[2]
            
            for j2 in range(int(j2_best) - 10, int(j2_best) + 11, 2):
                for j3 in range(int(j3_best) - 10, int(j3_best) + 11, 2):
                    if j2 < 0 or j2 > 180 or j3 < -180 or j3 > 0:
                        continue
                    solution = [joint1, float(j2), float(j3), 0.0, 0.0, 0.0]
                    actual = ArmKinematics.forward_kinematics(solution)
                    error = math.sqrt(
                        (actual[0] - target_x)**2 + 
                        (actual[1] - target_y)**2 + 
                        (actual[2] - target_z)**2
                    )
                    if error < best_error:
                        best_error = error
                        best_solution = solution
        
        return best_solution
    
    @staticmethod
    def forward_kinematics(joints: List[float]) -> Tuple[float, float, float]:
        """
        Calculate end effector position from joint angles.
        Must match Three.js transformation hierarchy EXACTLY.
        
        Three.js uses right-handed coordinate system with Y-up.
        Rotation matrices follow Three.js conventions.
        """
        j1_rad = math.radians(joints[0])  # Base rotation (Y-axis)
        j2_rad = math.radians(joints[1])  # Shoulder (Z-axis in local frame)
        j3_rad = math.radians(joints[2])  # Elbow (Z-axis in local frame)
        j5_rad = math.radians(joints[4])  # Wrist bend (Z-axis in local frame)
        
        # Start at world origin
        x, y, z = 0, 0, 0
        
        # Move up to J1 (base rotation point)
        y += ArmKinematics.BASE_TO_J1
        
        # Move up to J2 (shoulder)
        y += ArmKinematics.J1_TO_J2
        
        # From J2, move along Link 1 (upper arm)
        # J2 rotates in the arm's plane: j2_rad rotates from +Y toward horizontal
        L1 = ArmKinematics.J2_TO_J3
        link1_horizontal = L1 * math.sin(j2_rad)
        link1_vertical = L1 * math.cos(j2_rad)
        
        # Rotate horizontal component by j1 (base rotation) to get world X, Z
        # Three.js Y-rotation with coordinate system adjustment
        # Negate both X and Z to match Three.js coordinate system
        x += link1_horizontal * math.sin(j1_rad)
        z += -link1_horizontal * math.cos(j1_rad)
        y += link1_vertical
        
        # From J3, move along Link 2 (forearm)
        # J3 adds to J2's rotation
        combined_angle = j2_rad + j3_rad
        L2 = ArmKinematics.J3_TO_J4
        link2_horizontal = L2 * math.sin(combined_angle)
        link2_vertical = L2 * math.cos(combined_angle)
        
        x += link2_horizontal * math.sin(j1_rad)
        z += -link2_horizontal * math.cos(j1_rad)
        y += link2_vertical
        
        # From J4, move to J5 (wrist)
        # Continues in same direction as forearm
        L_wrist = ArmKinematics.J4_TO_J5
        wrist_horizontal = L_wrist * math.sin(combined_angle)
        wrist_vertical = L_wrist * math.cos(combined_angle)
        
        x += wrist_horizontal * math.sin(j1_rad)
        z += -wrist_horizontal * math.cos(j1_rad)
        y += wrist_vertical
        
        # From J5, move to end effector
        # J5 adds to the combined angle
        combined_angle_with_wrist = j2_rad + j3_rad + j5_rad
        L_end = ArmKinematics.J5_TO_END
        end_horizontal = L_end * math.sin(combined_angle_with_wrist)
        end_vertical = L_end * math.cos(combined_angle_with_wrist)
        
        x += end_horizontal * math.sin(j1_rad)
        z += -end_horizontal * math.cos(j1_rad)
        y += end_vertical
        
        return (x, y, z)
    
    @staticmethod
    def is_reachable(x: float, y: float, z: float) -> bool:
        """Check if position is reachable."""
        horizontal_dist = math.sqrt(x**2 + z**2)
        shoulder_height = ArmKinematics.BASE_TO_J1 + ArmKinematics.J1_TO_J2
        target_y_rel = y - shoulder_height
        reach_dist = math.sqrt(horizontal_dist**2 + target_y_rel**2)
        
        total_length = (ArmKinematics.J2_TO_J3 + 
                       ArmKinematics.J3_TO_J4 + 
                       ArmKinematics.J4_TO_J5 + 
                       ArmKinematics.J5_TO_END)
        
        # Check distance from shoulder
        if reach_dist > total_length or reach_dist < 0.1:
            return False
        
        # Additional check: target must be above ground and not too close to base
        if y < 0.5:  # Below reasonable height
            return False
        
        # Check if target is inside the base cylinder (would collide)
        if horizontal_dist < 0.5 and y < shoulder_height:
            return False
        
        return True
