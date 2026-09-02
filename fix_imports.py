import os, re
directories = ["app", "src"]
def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    if "...Type." in content and "Type" not in content[:500]:
        content = re.sub(r"(import\s+\{.*?)\}(\s+from\s+[\x27\x22]@/constants/theme[\x27\x22])", r"\1, Type}\2", content, count=1)
    if "Spacing." in content and "Spacing" not in content[:500]:
        content = re.sub(r"(import\s+\{.*?)\}(\s+from\s+[\x27\x22]@/constants/theme[\x27\x22])", r"\1, Spacing}\2", content, count=1)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

for root, _, files in os.walk("."):
    if not ("app" in root or "src" in root): continue
    for file in files:
        if file.endswith(".tsx") or file.endswith(".ts"):
            process_file(os.path.join(root, file))

