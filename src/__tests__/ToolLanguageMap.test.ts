import { describe, it, expect } from 'vitest';
import { inferToolLanguage } from '../../webview-ui/src/utils/toolLanguageMap';

describe('inferToolLanguage', () => {
  it('maps Bash tool to bash language', () => {
    expect(inferToolLanguage('Bash')).toBe('bash');
  });

  it('maps BashOutput tool to bash language', () => {
    expect(inferToolLanguage('BashOutput')).toBe('bash');
  });

  it('infers typescript from .ts extension in inputSummary', () => {
    expect(inferToolLanguage('Read', 'src/index.ts')).toBe('typescript');
  });

  it('infers tsx from .tsx extension', () => {
    expect(inferToolLanguage('Read', 'components/App.tsx')).toBe('tsx');
  });

  it('infers python from .py extension', () => {
    expect(inferToolLanguage('Edit', 'scripts/main.py')).toBe('python');
  });

  it('infers json from .json extension', () => {
    expect(inferToolLanguage('Read', 'package.json')).toBe('json');
  });

  it('infers yaml from .yml extension', () => {
    expect(inferToolLanguage('Read', 'config.yml')).toBe('yaml');
  });

  it('infers rust from .rs extension', () => {
    expect(inferToolLanguage('Write', 'src/main.rs')).toBe('rust');
  });

  it('infers go from .go extension', () => {
    expect(inferToolLanguage('Read', 'main.go')).toBe('go');
  });

  it('infers markup from .html extension', () => {
    expect(inferToolLanguage('Read', 'index.html')).toBe('markup');
  });

  it('infers css from .css extension', () => {
    expect(inferToolLanguage('Read', 'styles.css')).toBe('css');
  });

  it('returns text for Grep tool with no extension match', () => {
    expect(inferToolLanguage('Grep', 'pattern: foo')).toBe('text');
  });

  it('returns text for unknown tool with no inputSummary', () => {
    expect(inferToolLanguage('UnknownTool')).toBe('text');
  });

  it('returns text for unknown extension', () => {
    expect(inferToolLanguage('Read', 'data.xyz')).toBe('text');
  });

  it('handles extension followed by space', () => {
    expect(inferToolLanguage('Read', 'file.ts (42 lines)')).toBe('typescript');
  });

  it('handles extension at end of string', () => {
    expect(inferToolLanguage('Write', 'output.json')).toBe('json');
  });

  it('prefers direct tool map over extension inference', () => {
    // Bash tool should return bash even if inputSummary has .py
    expect(inferToolLanguage('Bash', 'python script.py')).toBe('bash');
  });
});
