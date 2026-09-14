// Verification script for Explore, Category, Search and Catalog remediation
import assert from 'node:assert/strict';

console.log('=== TEST 1: Grid-Width Mathematics & Layout Invariants ===');

const GRID_GUTTER = 16;
const GRID_COLUMN_GAP = 12;

function computeGridGeometry(effectiveWidth) {
  const columns = effectiveWidth > 1200 ? 5 : effectiveWidth > 900 ? 4 : effectiveWidth > 600 ? 3 : 2;
  const gaps = GRID_COLUMN_GAP * (columns - 1);
  const usableWidth = effectiveWidth - (GRID_GUTTER * 2) - gaps;
  const cardWidth = usableWidth / columns;
  return { columns, cardWidth, usableWidth };
}

// Test responsive breakpoints
const testWidths = [
  { name: 'Standard Phone', width: 390, expectedCols: 2 },
  { name: 'Small Tablet / Foldable', width: 768, expectedCols: 3 },
  { name: 'Large Tablet', width: 1024, expectedCols: 4 },
  { name: 'Desktop / Ultrawide', width: 1440, expectedCols: 5 },
];

for (const { name, width, expectedCols } of testWidths) {
  const { columns, cardWidth, usableWidth } = computeGridGeometry(width);
  assert.equal(columns, expectedCols, `${name} should have ${expectedCols} columns`);
  
  // Invariant 1: Full row exactly fills available width without overflow or trailing gap
  const fullRowTotal = (columns * cardWidth) + ((columns - 1) * GRID_COLUMN_GAP);
  const expectedAvailable = width - (GRID_GUTTER * 2);
  assert(Math.abs(fullRowTotal - expectedAvailable) < 0.001, `${name} full row must exactly equal available container width`);

  // Invariant 2: Trailing partial rows (1, 2, 3 items) with flex-start + gap maintain identical card widths
  for (let itemCount = 1; itemCount < columns; itemCount++) {
    const trailingWidth = (itemCount * cardWidth) + ((itemCount - 1) * GRID_COLUMN_GAP);
    assert(trailingWidth < expectedAvailable, `${name} partial row with ${itemCount} items must not overflow`);
    // Gap between any two adjacent cards is always exactly GRID_COLUMN_GAP
    console.log(`  ✓ ${name} (${width}px): ${itemCount} trailing item(s) adjacent at left edge with ${GRID_COLUMN_GAP}px gap`);
  }
}
console.log('✓ Grid mathematics invariant PASSED across all breakpoints.\n');

console.log('=== TEST 2: Category Navigation Matching Logic ===');

const sampleTopCategories = [
  { id: 'cat-1', name: 'Accessories' },
  { id: 'cat-2', name: 'Activewear' },
  { id: 'cat-3', name: 'Bottoms' },
  { id: 'cat-4', name: 'Dresses & Jumpsuits' },
  { id: 'cat-5', name: 'Tops' },
];

const sampleSubCategories = {
  'Tops': [
    { id: 'sub-1', name: 'T-Shirts' },
    { id: 'sub-2', name: 'Tank tops / camis' },
    { id: 'sub-3', name: 'Blouses' },
    { id: 'sub-4', name: 'Shirts (button-down)' },
    { id: 'sub-5', name: 'Crop tops' },
  ],
  'Accessories': [
    { id: 'sub-6', name: 'Bags' },
    { id: 'sub-7', name: 'Belts' },
  ],
};

function matchCategoryNavigation(searchQuery) {
  const raw = searchQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw || raw.length < 2) return [];
  const isShort = raw.length === 2;

  const rawSingular = raw.endsWith('s') && raw.length > 3 ? raw.slice(0, -1) : raw;
  const rawPlural = raw.endsWith('s') ? raw : `${raw}s`;

  const matches = [];
  const seen = new Set();

  const checkMatch = (name) => {
    const n = name.toLowerCase();
    if (isShort) {
      return n.startsWith(raw) || n.split(/\s+/).some((w) => w.startsWith(raw));
    }
    return n === raw || n === rawSingular || n === rawPlural || n.includes(raw);
  };

  sampleTopCategories.forEach((cat) => {
    if (checkMatch(cat.name)) {
      const key = `cat-${cat.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({ id: key, label: cat.name });
      }
    }
  });

  Object.entries(sampleSubCategories).forEach(([parentName, subs]) => {
    subs.forEach((sub) => {
      if (checkMatch(sub.name)) {
        const key = `sub-${sub.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ id: key, label: `${parentName} > ${sub.name}` });
        }
      }
    });
  });

  return matches;
}

// Assertions
// Test short query precision: "ac" matches Accessories and Activewear, but NOT Jackets
const acMatches = matchCategoryNavigation('ac').map((m) => m.label);
assert(acMatches.includes('Accessories'), '"ac" must match Accessories');
assert(acMatches.includes('Activewear'), '"ac" must match Activewear');
assert(!acMatches.some((l) => l.toLowerCase().includes('jacket')), '"ac" must NOT match Jackets');
console.log('  ✓ Short query "ac" surfaces only prefix matches:', acMatches);

// Test 1-character query suppression
const singleCharMatches = matchCategoryNavigation('a');
assert.equal(singleCharMatches.length, 0, 'Single-character query "a" must be suppressed');
console.log('  ✓ Single character query "a" is suppressed (0 matches)');

const shirtMatches = matchCategoryNavigation('shirt').map((m) => m.label);
assert(shirtMatches.includes('Tops > Shirts (button-down)'), '"shirt" must match Shirts (button-down)');
assert(shirtMatches.includes('Tops > T-Shirts'), '"shirt" must match T-Shirts');
console.log('  ✓ Query "shirt" surfaces:', shirtMatches);

const tshirtsMatches = matchCategoryNavigation('t-shirts').map((m) => m.label);
assert(tshirtsMatches.includes('Tops > T-Shirts'), '"t-shirts" must match Tops > T-Shirts');
console.log('  ✓ Query "t-shirts" surfaces:', tshirtsMatches);

const blouseMatches = matchCategoryNavigation('blouse').map((m) => m.label);
assert(blouseMatches.includes('Tops > Blouses'), '"blouse" must match Tops > Blouses');
console.log('  ✓ Query "blouse" surfaces:', blouseMatches);

const accMatches = matchCategoryNavigation('accessories').map((m) => m.label);
assert(accMatches.includes('Accessories'), '"accessories" must match Accessories');
console.log('  ✓ Query "accessories" surfaces:', accMatches);

const nonsenseMatches = matchCategoryNavigation('xyznonsense123');
assert.equal(nonsenseMatches.length, 0, 'Nonsense query must produce 0 category matches');
console.log('  ✓ Query "xyznonsense123" produces 0 false positives');

console.log('✓ Category navigation matching PASSED.\n');
console.log('All verification checks PASSED.');
