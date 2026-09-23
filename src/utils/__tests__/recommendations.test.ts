import { Candidate, RecommendationSignals, scoreCandidate, rankCandidates } from '../recommendations';

describe('recommendations scoring engine', () => {
  const currentSubCategoryId = 'sub-tees-1';
  const parentSubCategoryIds = new Set(['sub-tees-1', 'sub-shirts-2', 'sub-hoodies-3']);
  const affinityCategoryIds = new Set(['sub-jewelry-9', 'sub-bags-8']);

  const signals: RecommendationSignals = {
    currentSubCategoryId,
    parentSubCategoryIds,
    affinityCategoryIds,
  };

  it('prioritizes same subcategory items above everything else', () => {
    const sameSubProduct: Candidate = {
      category_id: 'sub-tees-1',
      on_sale: false,
      rating: 4.0,
    };

    const affinityProductOnSale5Star: Candidate = {
      category_id: 'sub-jewelry-9',
      on_sale: true,
      rating: 5.0,
    };

    const sameSubScore = scoreCandidate(sameSubProduct, signals);
    const affinityScore = scoreCandidate(affinityProductOnSale5Star, signals);

    // sameSub: 10 + 1.6 = 11.6
    // affinity: 2 (affinity) + 1 (sale) + 2.0 (rating) = 5.0
    expect(sameSubScore).toBeGreaterThan(affinityScore);
  });

  it('prioritizes same parent category items over cross-category affinity items', () => {
    const sameParentProduct: Candidate = {
      category_id: 'sub-shirts-2',
      on_sale: false,
      rating: 3.5,
    };

    const affinityJewelryOnSale5Star: Candidate = {
      category_id: 'sub-jewelry-9',
      on_sale: true,
      rating: 5.0,
    };

    const sameParentScore = scoreCandidate(sameParentProduct, signals);
    const affinityScore = scoreCandidate(affinityJewelryOnSale5Star, signals);

    // sameParent: 6 + 1.4 = 7.4
    // affinity: 2 + 1 + 2.0 = 5.0
    expect(sameParentScore).toBeGreaterThan(affinityScore);
  });

  it('ranks items properly according to hierarchy', () => {
    const items = [
      { id: '1', category_id: 'sub-jewelry-9', on_sale: true, rating: 5.0 }, // affinity: 5.0
      { id: '2', category_id: 'sub-shirts-2', on_sale: false, rating: 4.0 },  // same parent: 6 + 1.6 = 7.6
      { id: '3', category_id: 'sub-tees-1', on_sale: false, rating: 4.0 },    // same sub: 10 + 1.6 = 11.6
    ];

    const ranked = rankCandidates(items, signals, 3);

    expect(ranked.map((p) => p.id)).toEqual(['3', '2', '1']);
  });
});
