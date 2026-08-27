import os

files = [
    'app/outfit-builder.tsx',
    'app/_layout.tsx',
    'app/ar-tryon/[id].tsx'
]

for f in files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        
        content = content.replace('pointerEvents="box-none"', 'style={{ pointerEvents: \'box-none\' as any }}')
        content = content.replace('pointerEvents="none"', 'style={{ pointerEvents: \'none\' as any }}')
        content = content.replace('pointerEvents="auto"', 'style={{ pointerEvents: \'auto\' as any }}')
        
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
