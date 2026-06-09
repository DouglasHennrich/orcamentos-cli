# Feature Specification: Threshold Discount Rule

**Feature Branch**: `002-threshold-discount-rule`

**Created**: 2026-06-09

**Status**: Draft

**Input**: User description: "threshold-discount rule — new product_rules type that applies a discount to any product in the quote when the product's box count meets or exceeds a configured minimum."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Quantity-Based Discount Tier (Priority: P1)

As a user managing provider rules, I want to set a discount rule that automatically applies to any product when its box quantity reaches a threshold, so I don't have to create one rule per product.

**Why this priority**: Core value of the feature — enables bulk discount configuration without per-product repetition.

**Independent Test**: Can be fully tested by creating a threshold-discount rule via `agent-orcamento rules`, running a quote with products above and below the threshold, and confirming that only qualifying products receive the configured discount.

**Acceptance Scenarios**:

1. **Given** I am in the rules editor, **When** I select "Desconto por Quantidade" as the rule type, **Then** I am prompted for minimum box count and discount percentage only (no product code field).
2. **Given** I have created a threshold-discount rule (>=10 cx → 15%) for provider "autoamerica", **When** I run a quote with a product that has 10 boxes, **Then** that product receives 15% discount instead of the platform's automatic discount.
3. **Given** I have created a threshold-discount rule (>=10 cx → 15%) for provider "autoamerica", **When** I run a quote with a product that has 9 boxes, **Then** that product receives the platform's automatic discount (threshold not met).

---

### User Story 2 - Multiple Discount Tiers per Provider (Priority: P2)

As a user, I want to define multiple quantity tiers (e.g., >=5 cx → 10%, >=10 cx → 15%) so that higher-volume products automatically receive a better discount.

**Why this priority**: Natural extension — single-tier is useful, but multi-tier unlocks real volume discount policies.

**Independent Test**: Can be tested by creating two threshold rules for the same provider and running a quote where different products qualify for different tiers, confirming each gets the highest applicable discount.

**Acceptance Scenarios**:

1. **Given** two threshold rules exist (>=5 cx → 10% and >=10 cx → 15%), **When** a product has 12 boxes, **Then** it receives 15% (highest matching tier).
2. **Given** two threshold rules exist (>=5 cx → 10% and >=10 cx → 15%), **When** a product has 7 boxes, **Then** it receives 10% (only lower tier matches).
3. **Given** two threshold rules exist, **When** I view the rules list, **Then** each threshold rule is displayed with its minimum box count and discount percentage.

---

### User Story 3 - Override-Discount Takes Priority (Priority: P3)

As a user, I want product-specific override-discount rules to always win over threshold-discount rules, so I can fine-tune exceptions without disrupting the global policy.

**Why this priority**: Correctness guarantee — without this, adding a threshold rule could unexpectedly change discounts for products already covered by explicit overrides.

**Independent Test**: Can be tested by having both an override-discount rule (product X → 5%) and a threshold-discount rule (>=10 cx → 15%) active, running a quote where product X has 15 boxes, and confirming it receives 5% not 15%.

**Acceptance Scenarios**:

1. **Given** an override-discount rule for product "ABC" (5%) and a threshold rule (>=10 cx → 15%), **When** product "ABC" has 15 boxes in the quote, **Then** it receives 5% (override wins).
2. **Given** only a threshold-discount rule (>=10 cx → 15%) and no override for product "XYZ", **When** product "XYZ" has 15 boxes, **Then** it receives 15%.

---

### Edge Cases

- What happens when a product's box count is exactly equal to `quantity_value`? → Threshold is inclusive; it qualifies.
- What happens when no threshold rule matches and no override exists? → Platform automatic discount runs as usual.
- What happens when two threshold rules have the same `quantity_value`? → Prevented by UNIQUE constraint; duplicate insertion is rejected.
- What happens when a threshold rule is disabled? → Disabled rules are not applied.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a new rule type `threshold-discount` in the product rules editor.
- **FR-002**: A `threshold-discount` rule MUST be scoped globally to a provider (not tied to a specific product code).
- **FR-003**: The creation flow for `threshold-discount` MUST prompt only for minimum box count (integer > 0) and discount percentage (0–100); no product code prompt. Invalid values MUST display validation messages: min_boxes ≤ 0 → "Mínimo deve ser um número inteiro maior que 0"; duplicate tier → "Já existe uma regra com esse mínimo de caixas para este provider".
- **FR-004**: Multiple `threshold-discount` rules MAY exist for the same provider as long as each has a different minimum box count.
- **FR-005**: When evaluating discounts, the system MUST apply the highest `discount_pct` among all matching threshold rules for a product.
- **FR-006**: The threshold comparison MUST be inclusive: a product with exactly the minimum box count qualifies.
- **FR-007**: An `override-discount` rule for a specific product MUST take precedence over any matching `threshold-discount` rule.
- **FR-008**: When a threshold rule applies, it MUST replace the platform's automatic discount (same behavior as override-discount).
- **FR-009**: When no threshold matches and no override exists, the platform's automatic discount MUST run.
- **FR-010**: The rules list MUST display threshold-discount rules in the format: `[ATIVA] Desconto por quantidade: >=N cx -> M%`.
- **FR-011**: The schema for product rules MUST be updated so that the uniqueness constraint becomes `UNIQUE(provider, type, product_code, quantity_value)`, replacing the existing `UNIQUE(provider, type, product_code)`. This allows multiple `threshold-discount` rows for the same provider (all with `product_code='*'`) differing only by `quantity_value`. The `save()` upsert logic MUST be updated to conflict on the new four-column key. Because this is a breaking schema change, the table MUST be dropped and recreated (acceptable per the Assumptions section).
- **FR-012**: The system MUST log active threshold-discount tiers at the start of each quote run in interactive mode (e.g., `DESCONTO POR QUANTIDADE: >=5 cx → 10%, >=10 cx → 15%`). This log is suppressed when `interactive = false`.

### Key Entities

- **ProductRule**: Represents a persistent rule applied automatically to quotes. For `threshold-discount`: `provider`, `type='threshold-discount'`, `product_code='*'`, `quantity_value` (min boxes, integer > 0), `discount_pct` (integer 1–100; a value of 0 is disallowed as it would be a no-op), `enabled`. The TypeScript `type` union MUST be extended to include `'threshold-discount'`.
- **Discount Priority Order**: `override-discount` (product-specific) > `threshold-discount` (highest matching tier) > platform auto-discount.
- **Box Count for Threshold Evaluation**: The box count used for threshold evaluation is the **final** count after all minimum-value-loop bumps have been applied. If a product is bumped from 9 to 10 boxes during the minimum-value loop, it qualifies for a `>=10` threshold rule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a threshold-discount rule for any provider using the rules editor without needing to know a product code (UX goal; not enforced by automated tests).
- **SC-002**: All products in a quote are evaluated against threshold rules independently — no product's discount is affected by another product's box count.
- **SC-003**: When multiple tiers exist, the correct tier (highest matching discount) is applied 100% of the time.
- **SC-004**: Products with an explicit override-discount are never affected by threshold rules.
- **SC-005**: Quotes containing products both above and below the threshold correctly split discount application with no manual intervention.

## Clarifications

### Session 2026-06-09

- Q: What validation message should display when min_boxes is 0 or non-integer? → A: "Mínimo deve ser um número inteiro maior que 0"
- Q: What message should display when a duplicate tier (same provider + quantity_value) is attempted? → A: "Já existe uma regra com esse mínimo de caixas para este provider"

## Out of Scope

- Fractional discount percentages (e.g., 12.5%) — integer percentages only.
- Time-limited or date-bounded discount tiers.
- Per-customer or per-segment threshold rules.
- Unit-based thresholds (the threshold is always in boxes, never in individual units).
- Any platform other than those already supported (`autoamerica`, `roberlo`).

## Assumptions

- The `product_rules` table is acceptable to reset (DROP + CREATE) since it was designed to be regenerated; no production migration is needed.
- `quantity_value` for `threshold-discount` rules represents box count (not units or other units).
- The `quantity_unit` column is not used for `threshold-discount` rules and is stored as `NULL`.
- Disabled rules (`enabled = false`) are excluded from discount evaluation.
- The edit flow for an existing `threshold-discount` rule exposes only min boxes and discount % fields; `product_code` (`'*'`) is not editable.
- A `discount_pct` of 0 is not a valid value for `threshold-discount` rules; validation MUST reject it (message: "O desconto deve ser entre 1 e 100%").
