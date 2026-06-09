# CLI Contracts: Threshold Discount Rule

## Rules Editor: New Type Option

The `agent-orcamento rules` interactive editor adds a third option to the type selector:

```
Tipo de regra:
  > Adicionar Produto (Sempre incluir)
    Desconto Fixo (Sobrescrever automático)
    Desconto por Quantidade (Global, por nível de caixas)   <- NEW
```

## Creation Flow: threshold-discount

Skips product code, name, and units_per_box prompts. Only asks:

```
Mínimo de caixas: [integer >= 1]
Percentual de desconto (1-100): [integer 1-100]
```

Stored as: product_code='*', quantity_unit=NULL, product_name=NULL, units_per_box=NULL.

## Display in Rule List

```
1. [ATIVA] Desconto por quantidade: >=10 cx -> 15%
2. [ATIVA] Desconto por quantidade: >=5 cx -> 10%
3. [ATIVA] Desconto fixo em ABC123 (Produto X) -> 20%
```

## Run Log (interactive mode only)

At start of quote run, after existing rule logging:

```
Regras ativas (autoamerica):
  - ADICIONAR: XYZ (2 CX)
  - DESCONTO FIXO: ABC (20%)
  - DESCONTO POR QUANTIDADE: >=5 cx -> 10%, >=10 cx -> 15%
```
