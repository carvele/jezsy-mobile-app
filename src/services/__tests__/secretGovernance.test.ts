import fs from 'fs';
import path from 'path';

describe('Secret Governance & Credential Security', () => {
  const repoRoot = path.resolve(__dirname, '../../../');
  const verifyPersonaScriptPath = path.join(repoRoot, 'scripts', 'security', 'verify_persona_rls.py');

  it('verify_persona_rls.py exists in scripts/security/', () => {
    expect(fs.existsSync(verifyPersonaScriptPath)).toBe(true);
  });

  it('prohibits hardcoded credential fallbacks in verify_persona_rls.py', () => {
    const content = fs.readFileSync(verifyPersonaScriptPath, 'utf-8');

    // Reject any fallback values for HARNESS_*_PASSWORD
    const passwordFallbackRegex = /HARNESS_(?:CUSTOMER|STAFF)_PASSWORD\s*=\s*os\.environ\.get\(\s*["']HARNESS_(?:CUSTOMER|STAFF)_PASSWORD["']\s*,\s*["'](?!["'])[^"']+["']\s*\)/;
    expect(content).not.toMatch(passwordFallbackRegex);

    // Reject any fallback values for HARNESS_*_EMAIL
    const emailFallbackRegex = /HARNESS_(?:CUSTOMER|STAFF)_EMAIL\s*=\s*os\.environ\.get\(\s*["']HARNESS_(?:CUSTOMER|STAFF)_EMAIL["']\s*,\s*["'](?!["'])[^"']+["']\s*\)/;
    expect(content).not.toMatch(emailFallbackRegex);

    // Explicitly reject known exposed legacy passwords
    expect(content).not.toContain('VerifyPersonaTest123!');
    expect(content).not.toContain('VerifyStaffTest123!');
  });

  it('enforces fail-closed validation on missing harness credentials', () => {
    const content = fs.readFileSync(verifyPersonaScriptPath, 'utf-8');

    // Must validate presence of all 4 required credentials
    expect(content).toContain('HARNESS_CUSTOMER_EMAIL');
    expect(content).toContain('HARNESS_CUSTOMER_PASSWORD');
    expect(content).toContain('HARNESS_STAFF_EMAIL');
    expect(content).toContain('HARNESS_STAFF_PASSWORD');

    // Must fail closed (sys.exit(1)) if any credential is missing
    expect(content).toMatch(/missing\s*=\s*\[k\s+for\s+k,\s*v\s+in\s+required_credentials\.items\(\)\s+if\s+not\s+v\]/);
    expect(content).toContain('Fail-closed: missing required harness credential environment variables');
    expect(content).toMatch(/sys\.exit\(1\)/);
  });

  it('scans scripts/security/ for unescaped hardcoded password literals', () => {
    const securityDir = path.join(repoRoot, 'scripts', 'security');
    const files = fs.readdirSync(securityDir).filter((f) => f.endsWith('.py') || f.endsWith('.sh') || f.endsWith('.ts'));

    for (const file of files) {
      const filePath = path.join(securityDir, file);
      const text = fs.readFileSync(filePath, 'utf-8');

      // Prohibit assigning non-empty string literals to password variables
      const suspiciousPasswordAssignment = /(?:password|secret)\s*=\s*["']([^"']{4,})["']/i;
      const match = text.match(suspiciousPasswordAssignment);
      if (match) {
        // Exclude dummy placeholders or empty strings
        const val = match[1];
        const isPlaceholder = val.includes('placeholder') || val.includes('dummy') || val.startsWith('$') || val === 'verify';
        expect(isPlaceholder).toBe(true);
      }
    }
  });
});
