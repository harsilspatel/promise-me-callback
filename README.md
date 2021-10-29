# promise-me-callback
> codemods for refactoring callbacks based functions to async-await syntax 🚀

## Usage
```bash
npm install -g jscodeshift
jscodeshift -t ./path/to/transformer.js ./path/to/js/source/**/*.js
```
### Refactoring callee
```js
// source.js
const squareRoot = (x, callback) => {
  if ((x) < 0) {
    callback(new Error('MathDomainError: square root of a negative number does not exist'))
  }
  const sqRt = Math.sqrt(x); // call me a math whiz
  callback(null, sqRt);
}
```

```js
// source.js transformed with remove-callback.js
const squareRoot = async x => {
  if ((x) < 0) {
    throw new Error('MathDomainError: square root of a negative number does not exist');
  }
  const sqRt = Math.sqrt(x); // call me a math whiz
  return sqRt;
}
```

### Refactoring caller
```js
// source.js
squareRoot(magicNumber, (error, magicNumberSquareRoot) => {
  if (err) {
    // ignoring error 'cause yolo
  }
  console.log(`Square root of ${magicNumber} is ${magicNumberSquareRoot}`)
})
```

```js
// source.js transformed with await-function.js
try {
  let magicNumberSquareRoot = await squareRoot(magicNumber);
  console.log(`Square root of ${magicNumber} is ${magicNumberSquareRoot}`)
} catch (error) {
  // ignoring error 'cause yolo
};
```

#### License
[MIT](https://github.com/localz/promise-me-callback/blob/master/LICENSE)
