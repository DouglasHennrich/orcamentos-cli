# Estratégia de Automação: Seleção Robusta em Portais APW Legados

Este documento detalha a "inteligência" implementada nos drivers do `agent-orcamento` para garantir que a seleção de Clientes e Tabela de Preços acione corretamente os eventos de backend (AJAX) em sistemas Protheus/APW.

## 1. O Problema: Injeção de Valor vs. Eventos DOM

Simplesmente alterar o `.value` de um elemento `<select>` via JavaScript não dispara os ouvintes de evento (`change`, `input`) do navegador, nem aciona scripts de frameworks (como jQuery ou Select2) que o portal utiliza para carregar dados dependentes (ex: carregar tabelas após selecionar cliente).

## 2. A Solução: Simulação de Intenção e Trigger Manual

A estratégia adotada nos drivers (`AutoAmericaDriver` e `RoberloDriver`) consiste em três camadas de execução:

### Camada A: Atualização do Valor e Evento jQuery
Como os portais utilizam jQuery, disparar o evento via `.trigger('change')` é o primeiro passo para notificar os scripts da página.

```javascript
jQuery('#CJ_CLIENTE').val(codigoInterno).trigger('change');
```

### Camada B: Execução de Callbacks Globais (Inteligência Específica)
Muitos portais legados definem funções globais no `window` que processam a lógica de negócio após a seleção. Identificamos e chamamos essas funções diretamente para garantir o fluxo:

1.  **SelCliente()**: Dispara a busca AJAX de tabelas de preço e condições de pagamento para o cliente selecionado.
2.  **selProd()**: Dispara a carga AJAX da lista de produtos permitidos para aquela combinação de cliente/tabela.

### Camada C: Verificação de Prontidão (Polling Inteligente)
Em vez de usar `setTimeout` fixo, utilizamos um método `waitFor` que monitora o DOM até que o próximo passo esteja pronto (ex: o dropdown de tabelas ter mais que 1 opção).

```typescript
const tabelasLoaded = await this.waitFor(
  `document.getElementById('CJ_TABELA')?.options.length > 1`,
  10000 // Timeout de 10s
);
```

## 3. Exemplo de Implementação (AutoAmerica)

No arquivo `src/platforms/autoamerica-driver.ts`, o método `selectClient` encapsula essa lógica:

```typescript
async selectClient(code: string): Promise<DriverResult> {
  // 1 & 2. Injeta valor e chama a função do portal
  await this.evalRaw(`
    jQuery('#CJ_CLIENTE').val(${JSON.stringify(code)}).trigger('change');
    SelCliente(); // Função global do portal
    'done'
  `);

  // 3. Monitora a carga da dependência
  const tabelasLoaded = await this.waitFor(
    `document.getElementById('CJ_TABELA')?.options.length > 1`,
    10000
  );
  
  if (!tabelasLoaded) throw new Error('Timeout ao carregar tabelas');
  
  return { status: 'success', summary: 'Cliente selecionado e tabelas carregadas' };
}
```

## 4. Persistência de Cabeçalho (Anti-Reset)

Descobrimos que a chamada do portal para `SelCliente()` pode resetar campos como **Transportadora** e **Tipo de Frete**. Por isso, a inteligência foi ajustada para re-aplicar esses campos no passo de `selectPriceTable`, garantindo que o formulário final esteja completo e correto antes de salvar.

---
*Documentação gerada para referência técnica do projeto orcamentos-cli.*
