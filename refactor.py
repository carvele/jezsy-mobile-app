import os, re
directories = ["app", "src"]
exclude = ["theme.ts", "colorOptions.ts"]

type_replacements = {
    r"fontSize:\s*12,\s*fontWeight:\s*[\x27\x22]500[\x27\x22]": "...Type.caption",
    r"fontSize:\s*11,\s*fontWeight:\s*[\x27\x22]700[\x27\x22],\s*letterSpacing:\s*1": "...Type.label",
    r"fontSize:\s*14,\s*fontWeight:\s*[\x27\x22]400[\x27\x22]": "...Type.body",
    r"fontSize:\s*15,\s*fontWeight:\s*[\x27\x22]600[\x27\x22]": "...Type.bodyStrong",
    r"fontSize:\s*16,\s*fontWeight:\s*[\x27\x22]400[\x27\x22]": "...Type.bodyLarge",
    r"fontSize:\s*16,\s*fontWeight:\s*[\x27\x22]700[\x27\x22]": "...Type.bodyLargeStrong",
    r"fontSize:\s*18,\s*fontWeight:\s*[\x27\x22]700[\x27\x22]": "...Type.subtitle",
    r"fontSize:\s*20,\s*fontWeight:\s*[\x27\x22]700[\x27\x22]": "...Type.title",
    r"fontSize:\s*24,\s*fontWeight:\s*[\x27\x22]800[\x27\x22]": "...Type.headline",
    r"fontSize:\s*32,\s*fontWeight:\s*[\x27\x22]800[\x27\x22]": "...Type.display",
}

spacing_replacements = {
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*4\b": r"\1: Spacing.xs",
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*8\b": r"\1: Spacing.sm",
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*12\b": r"\1: Spacing.md",
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*16\b": r"\1: Spacing.lg",
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*20\b": r"\1: Spacing.xl",
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*24\b": r"\1: Spacing.xxl",
    r"\b(padding|margin|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap):\s*32\b": r"\1: Spacing.xxxl",
}

def process_file(filepath):
    if any(ex in filepath for ex in exclude): return

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    modified = content
    for regex, replacement in type_replacements.items():
        modified = re.sub(regex, replacement, modified)
    for regex, replacement in spacing_replacements.items():
        modified = re.sub(regex, replacement, modified)
    if content != modified:
        if "...Type." in modified and "Type" not in content:
            if "from \"@/constants/theme\"" in modified or "from \x27@/constants/theme\x27" in modified:
                modified = re.sub(r"(import\s+\{.*?)\}(\s+from\s+[\x27\x22]@/constants/theme[\x27\x22])", r"\1, Type}\2", modified, count=1)
            else:
                modified = "import { Type } from \x27@/constants/theme\x27;\n" + modified
        if "Spacing." in modified and "Spacing" not in content:
            if "from \"@/constants/theme\"" in modified or "from \x27@/constants/theme\x27" in modified:
                modified = re.sub(r"(import\s+\{.*?)\}(\s+from\s+[\x27\x22]@/constants/theme[\x27\x22])", r"\1, Spacing}\2", modified, count=1)
            else:
                modified = "import { Spacing } from \x27@/constants/theme\x27;\n" + modified
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(modified)
        print(f"Refactored {filepath}")

for root, _, files in os.walk("."):
    # Fix the directory check for Windows
    root_norm = os.path.normpath(root)
    parts = root_norm.split(os.sep)
    if len(parts) > 1 and parts[1] in directories or parts[0] in directories:
        pass
    else:
        continue
    for file in files:
        if file.endswith(".tsx") or file.endswith(".ts"):
            process_file(os.path.join(root, file))

