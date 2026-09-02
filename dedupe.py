import os, re
directories = ['app', 'src']
for root, _, files in os.walk('.'):
    if not any(d in root for d in directories): continue
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            original = content
            
            import_match = re.search(r'import\s+\{([^}]+)\}\s+from\s+[\x27\x22]@/constants/theme[\x27\x22]', content)
            if import_match:
                imports_str = import_match.group(1)
                imports_list = [i.strip() for i in imports_str.split(',') if i.strip()]
                unique_imports = list(dict.fromkeys(imports_list))
                new_imports_str = ', '.join(unique_imports)
                new_import_line = f\
import
{ {new_imports_str} }
from
@/constants/theme
\
                content = content[:import_match.start()] + new_import_line + content[import_match.end():]

            if 'outfit-builder.tsx' in file:
                content = re.sub(r'import Animated, \{ useSharedValue, ZoomIn, FadeOut\s*\n', 'import Animated, { useSharedValue, ZoomIn, FadeOut }\\n', content)
            
            if content != original:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)

