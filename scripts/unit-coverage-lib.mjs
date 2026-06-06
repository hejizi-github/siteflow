function parsePct(value) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

export function parseCoverageSummary(output) {
  const lines = output.split(/\r?\n/);
  const summaryLine = [...lines].reverse().find(line => line.includes('all files') && line.includes('|'));
  if (!summaryLine) {
    throw new Error('Coverage summary line not found in runner output');
  }

  const cleaned = summaryLine.replace(/^.*?all files/, 'all files');
  const match = cleaned.match(/all files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)/);
  if (!match) {
    throw new Error(`Unable to parse coverage summary line: ${summaryLine}`);
  }

  return {
    linesPct: Number(match[1]),
    branchesPct: Number(match[2]),
    functionsPct: Number(match[3]),
  };
}

export function parseCoverageFiles(output) {
  const lines = output.split(/\r?\n/);
  const files = [];
  const stack = [];

  for (const line of lines) {
    if (!line.startsWith('ℹ')) continue;
    if (!line.includes('|')) continue;

    const withoutMarker = line.slice(1);
    const [nameColumn, linePctColumn, branchPctColumn, funcsPctColumn, uncoveredColumn = ''] = withoutMarker.split('|');
    const nameRaw = nameColumn.replace(/^[\s]+/, '');
    const name = nameRaw.trim();
    if (!name || name === 'file' || /^-+$/.test(name) || name === 'all files') continue;

    const depth = (nameColumn.match(/^\s*/) ?? [''])[0].length;
    const linePct = parsePct(linePctColumn);
    const branchPct = parsePct(branchPctColumn);
    const funcsPct = parsePct(funcsPctColumn);
    const uncovered = uncoveredColumn.trim();

    if (linePct == null && branchPct == null && funcsPct == null && !uncovered) {
      stack[depth] = name;
      stack.length = depth + 1;
      continue;
    }

    const directories = stack.slice(0, depth).filter(Boolean);
    files.push({
      path: [...directories, name].join('/'),
      linePct: linePct ?? 0,
      branchesPct: branchPct ?? 0,
      functionsPct: funcsPct ?? 0,
      uncovered,
    });
  }

  return files;
}

export function formatUncoveredReport(files) {
  const uncoveredFiles = files
    .filter(file => file.uncovered)
    .sort((a, b) => a.linePct - b.linePct || a.path.localeCompare(b.path));

  if (uncoveredFiles.length === 0) {
    return 'All covered files reported zero uncovered lines.';
  }

  return uncoveredFiles
    .map((file, index) => `${index + 1}. ${file.path} | lines ${file.linePct.toFixed(2)}% | branches ${file.branchesPct.toFixed(2)}% | funcs ${file.functionsPct.toFixed(2)}%\n   uncovered: ${file.uncovered}`)
    .join('\n\n');
}
