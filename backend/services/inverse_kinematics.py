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
        """
        # Joint 1: Base rotation towards target
        horizontal_dist = math.sqrt(target_x**2 + target_z**2)
        joint1 = math.degrees(math.atan2(target_x, target_z))
        
        # Height of shoulder joint (J2) in world space
        shoulder_height = ArmKinematics.BASE_TO_J1 + ArmKinematics.J1_TO_J2
        
        # Target relative to shoulder
        target_y_rel = target_y - shoulder_height
        
        # Total arm length from shoulder
        total_length = (ArmKinematics.J2_TO_J3 + 
                       ArmKinematics.J3_TO_J4 + 
                       ArmKinematics.J4_TO_J5 + 
                       ArmKinematics.J5_TO_END)
        
        # Distance from shoulder to target
        reach_dist = math.sqrt(horizontal_dist**2 + target_y_rel**2)
        
        if reach_dist > total_length or reach_dist < 0.1:
            return None
        
        # Effective reach (subtract end effector)
        eff_length = ArmKinematics.J4_TO_J5 + ArmKinematics.J5_TO_END
        target_reach = reach_dist - eff_length
        if target_reach < 0:
            target_reach = 0.1
        
        # Two-link IK for shoulder and elbow
        L1 = ArmKinematics.J2_TO_J3
        L2 = ArmKinematics.J3_TO_J4
        
        # Law of cosines for elbow
        cos_elbow = (L1**2 + L2**2 - target_reach**2) / (2 * L1 * L2)
        cos_elbow = max(-1.0, min(1.0, cos_elbow))
        elbow_angle = math.acos(cos_elbow)
        
        # Joint 3: Elbow (negative for downward bend)
        joint3 = -math.degrees(elbow_angle)
        
        # Angle to target from shoulder
        alpha = math.atan2(target_y_rel, horizontal_dist)
        
        # Law of cosines for shoulder
        cos_beta = (L1**2 + target_reach**2 - L2**2) / (2 * L1 * target_reach)
        cos_beta = max(-1.0, min(1.0, cos_beta))
        beta = math.acos(cos_beta)
        
        # Joint 2: Shoulder angle from vertical
        # In Three.js, rotation.z = 0 means pointing up (+Y)
        # Positive rotation.z rotates towards +X
        shoulder_angle_from_vertical = alpha + beta
        joint2 = math.degrees(shoulder_angle_from_vertical)
        
        # Joint 4: No wrist rotation
        joint4 = 0
        
        # Joint 5: Keep end effector pointing down
        # Total angle of arm = joint2 + joint3
        # We want end effector vertical, so compensate
        joint5 = -(joint2 + joint3)
        
        # Joint 6: Not used
        joint6 = 0
        
        return [joint1, joint2, joint3, joint4, joint5, joint6]
    
    @staticmethod
    def forward_kinematics(joints: List[float]) -> Tuple[float, float, float]:
        """
        Calculate end effector position from joint angles.
        Must match Three.js transformation hierarchy exactly.
        """
        j1_rad = math.radians(joints[0])
        j2_rad = math.radians(joints[1])
        j3_rad = math.radians(joints[2])
        j5_rad = math.radians(joints[4])
        
        # Start at world origin
        x, y, z = 0, 0, 0
        
        # Move to J1 (base rotation point)
        y += ArmKinematics.BASE_TO_J1
        
        # J1 rotates around Y-axis (affects X and Z)
        # After J1, move to J2
        y += ArmKinematics.J1_TO_J2
        
        # J2 rotates around Z-axis
        # This rotates the +Y direction
        # After J2, move along Link 1
        link1_local_y = ArmKinematics.J2_TO_J3
        link1_x = link1_local_y * math.sin(j2_rad)
        link1_y = link1_local_y * math.cos(j2_rad)
        
        # Rotate by J1 to get world coordinates
        x += link1_x * math.sin(j1_rad)
        y += link1_y
        z += link1_x * math.cos(j1_rad)
        
        # J3 rotates around Z-axis (adds to J2 rotation)
        # After J3, move along Link 2
        combined_angle_23 = j2_rad + j3_rad
        link2_local_y = ArmKinematics.J3_TO_J4
        link2_x = link2_local_y * math.sin(combined_angle_23)
        link2_y = link2_local_y * math.cos(combined_angle_23)
        
        x += link2_x * math.sin(j1_rad)
        y += link2_y
        z += link2_x * math.cos(j1_rad)
        
        # J4 (wrist rotation) - doesn't affect position
        # Move to J5
        y += ArmKinematics.J4_TO_J5
        
        # J5 rotates around Z-axis (adds to previous rotations)
        combined_angle_235 = j2_rad + j3_rad + j5_rad
        end_local_y = ArmKinematics.J5_TO_END
        end_x = end_local_y * math.sin(combined_angle_235)
        end_y = end_local_y * math.cos(combined_angle_235)
        
        x += end_x * math.sin(j1_rad)
        y += end_y
        z += end_x * math.cos(j1_rad)
        
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
        
        return 0.1 <= reach_dist <= total_length
