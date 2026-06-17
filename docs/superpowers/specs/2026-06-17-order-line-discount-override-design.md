# Order Line Discount Override — Design Spec

## Goal
Add support for an explicit per-order line discount field in order JSON so the requested discount percentage overrides any platform or rule-based discount logic.

## Scope
- Accept optional `discount` on every `produtos[]` entry in the order input.
- Parse the value as a number, allowing negatives and decimals.
- Apply this discount in the orchestrator before any platform or rule-driven discount logic.
- Preserve existing automatic and rule behavior when `discount` is not present.
- No changes to the product rules database or CLI rule editor.

## Existing behavior
The orchestrator currently applies discounts in this order:
1. `override-discount` product rules
2. `threshold-discount` rules by box count
3. platform auto-discount logic

If no rules apply, the platform-specific discount algorithm may set a per-line discount.

## Design
### Order model
Update `src/orcamento/order.ts`:
- Extend `OrderLine` with `discount?: number`.
- Accept `discount` in `parseOrder()` as an optional numeric field.
- Validate `discount` is a finite number; reject non-number values.

Example input:
```js
{
  name: 'FAST CUT AUTOAMERICA',
  quantity: '36 UN',
  discount: -15,
}
```

### Discount precedence
In `src/orcamento/orchestrator.ts`:
- During per-line discount processing, if `line.discount` is defined:
  - call `driver.applyDiscount(l.productCode, l.discount)`
  - skip all remaining discount logic for that line
- This includes skipping:
  - `override-discount` rules
  - `threshold-discount` rules
  - platform automatic discount lookup/apply

This creates a direct user-controlled override that can force negative or positive discount values.

### Validation rules
- `discount` may be positive, negative, or zero.
- `discount` may include decimal values.
- The value must be a finite number.
- Invalid `discount` values should fail order parsing cleanly with a helpful error.

### Tests
Add or update tests for:
- `parseOrder()` accepting `discount: 20`, `discount: -15`, and `discount: 2.5`
- orchestrator behavior where explicit `discount` overrides existing platform targeting rules
- explicit `discount: 0` skipping automatic discounts
- explicit negative discount being passed through to `driver.applyDiscount`

## Impact
- Order JSON now supports explicit line-level discounts.
- Existing rule engine and platform behavior remain intact when `discount` is absent.
- Implementation is localized to order parsing and orchestrator discount application.

## Next step
Once this spec is signed off, the implementation plan will modify:
- `src/orcamento/order.ts`
- `src/orcamento/orchestrator.ts`
- tests in `tests/orcamento/order.test.ts` and `tests/orcamento/orchestrator.test.ts`
