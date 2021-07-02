# promise-me-callback
> codemods for converting callbacks to promises 🚀

## AST transformation example
Object: Refactor ternary to logical where possible
### Source
```js
const tz = inputTz ? inputTz : "Australia/Melbourne";
const foo = bar ? baz : "";
```

### Codemod
```js
export default function transformer(file, api) {
  const j = api.jscodeshift;

  return j(file.source)
    .find(j.ConditionalExpression) // {test} ? {consequent} : {alternate}
  	.filter(path => path.node.test.name === path.node.consequent.name)
 	.replaceWith(p => {
    	return j.logicalExpression("||", j.identifier(p.node.test.name), p.node.alternate)
    })
    .toSource();
}
```

### Output
```js
const tz = inputTz || "Australia/Melbourne";
const foo = bar ? baz : "";
```
