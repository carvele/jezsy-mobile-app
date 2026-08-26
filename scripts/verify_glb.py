import sys
import struct
import json
import os

STANDARD_BONES = [
    'Spine', 'Spine1', 'Spine2',
    'LeftShoulder', 'LeftArm', 'LeftForeArm',
    'RightShoulder', 'RightArm', 'RightForeArm'
]

def verify_glb(filepath):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return False
        
    with open(filepath, 'rb') as f:
        # Read GLB Header
        magic = f.read(4)
        if magic != b'glTF':
            print(f"{filepath} is not a valid GLB file.")
            return False
            
        version, length = struct.unpack('<II', f.read(8))
        
        # Read Chunk 0 (JSON)
        chunk_len, chunk_type = struct.unpack('<II', f.read(8))
        # Handle case where chunk_type integer doesn't match exactly 'JSON' depending on endianness
        if chunk_type != 0x4E4F534A: # 'JSON' in little endian
            print("First chunk is not JSON.")
            return False
            
        json_data = f.read(chunk_len).decode('utf-8')
        gltf = json.loads(json_data)
        
    # Check for skins
    if 'skins' not in gltf or len(gltf['skins']) == 0:
        print(f"❌ [NOT_AR_COMPATIBLE] {filepath}: No skeleton (skin) found.")
        return False
        
    nodes = gltf.get('nodes', [])
    skin = gltf['skins'][0]
    joints = skin.get('joints', [])
    
    joint_names = []
    for j in joints:
        node = nodes[j]
        name = node.get('name', f'node_{j}')
        joint_names.append(name)
        
    mapped_count = 0
    missing_bones = []
    
    for std_bone in STANDARD_BONES:
        if std_bone in joint_names or f'mixamorig{std_bone}' in joint_names:
            mapped_count += 1
        else:
            missing_bones.append(std_bone)
            
    has_anchor = 'Spine2' in joint_names or 'mixamorigSpine2' in joint_names
    
    print(f"\n--- Analysis for {os.path.basename(filepath)} ---")
    print(f"Total Bones: {len(joints)}")
    print(f"Mapped AR Bones: {mapped_count}/{len(STANDARD_BONES)}")
    
    if mapped_count >= 3:
        if has_anchor:
            print("✅ [AR_READY] Garment has compatible rig and Spine2 anchor.")
            return True
        else:
            print("⚠️ [NEEDS_MERCHANT_MAPPING] Compatible rig, but missing Spine2 for anatomical anchoring.")
            return False
    else:
        print(f"⚠️ [NEEDS_MERCHANT_MAPPING] Missing standard bones: {', '.join(missing_bones)}")
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python verify_glb.py [path_to_glb]")
    else:
        for p in sys.argv[1:]:
            verify_glb(p)
