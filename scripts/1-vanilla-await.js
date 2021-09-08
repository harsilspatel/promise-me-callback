const ERROR_KEYWORDS = ['e', 'err', 'error', 'formattedError'];

module.exports = (file, api, options) => {
  const { jscodeshift: j } = api;
  const root = j(file.source);

  const isFnNode = (n) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type);
  const isAsyncLibraryNode = (n) => {
    try {
      return n.callee.object.name.toLowerCase() === 'async';
    } catch (e) {
      return false;
    }
  };
  const hasCallback = (p) => {
    const { node } = p;

    // if it is async.waterfall(), skip them as we run a different transformer
    if (isAsyncLibraryNode(node)) return false;

    let _hasCallback;
    try {
      const argsLen = node.arguments.length;
      const lastArg = node.arguments[argsLen - 1];
      _hasCallback = isFnNode(lastArg) && ERROR_KEYWORDS.includes(lastArg.params[0].name);
    } catch (e) {
      _hasCallback = false;
    }

    const isWithinAsync = j(p).closest(j.CallExpression, isAsyncLibraryNode).size() > 0;

    // we also do not transform all nodes within async.waterfall()
    return _hasCallback && !isWithinAsync;
  };

  const awaitFn = (p) => {
    // ensure parent function is converted to an `await` fn
    let parent = p;
    while (parent) {
      if (isFnNode(parent.node)) {
        parent.node.async = true;
        break;
      }
      parent = parent.parent;
    }

    // the CallExpression's arguments
    const argLen = p.node.arguments.length;
    // popping the last arg as its the callback fn
    const callbackFn = p.node.arguments.pop();
    const cbParams = callbackFn.params;

    // get the error identifier
    const firstParam = cbParams.shift();
    const returnValues = cbParams.length;
    const hasReturnValue = !!returnValues;

    // check if there is an if statement checking for error

    // sometimes the callback is without a blockStatement, for e.g `(err) => fn(err, work)`
    if (!callbackFn.body.body && callbackFn.body.callee) callbackFn.body.body = [j.returnStatement(callbackFn.body.callee)];

    const firstCbExpr = callbackFn.body.body[0];
    const hasCatchClause =
      firstCbExpr.type === 'IfStatement' && firstCbExpr.test.type === 'Identifier' && firstCbExpr.test.name === firstParam.name;

    // if there is, then all it's contents go to the body of `catch` clause
    const catchBody = hasCatchClause
      ? firstCbExpr.consequent.type === 'BlockStatement'
        ? firstCbExpr.consequent
        : j.blockStatement([firstCbExpr.consequent])
      : j.blockStatement([]);

    // create await expression
    const awaitExpression = j.awaitExpression(j.callExpression(p.node.callee, p.node.arguments));
    const expressionStatement = j.expressionStatement(awaitExpression);

    // if more than 1 values then destructure variables from an
    const variableDeclaratorId = returnValues > 1 ? j.arrayPattern(cbParams) : cbParams[0];
    // if it is returning a value declare the variable
    const awaitWrapperExpr = hasReturnValue
      ? j.variableDeclaration('let', [j.variableDeclarator(variableDeclaratorId, awaitExpression)])
      : expressionStatement;

    let afterAwaitExprs = [];

    // if the catch clause is found then everything inside `else` will go below await statement
    if (hasCatchClause) {
      afterAwaitExprs = afterAwaitExprs.concat(firstCbExpr.alternate ? firstCbExpr.alternate.body : []);
      // remove the `if-else`
      callbackFn.body.body.shift();
    } else {
      const comments = awaitWrapperExpr.comments || [];
      comments.push(j.commentLine(' TODO(codemods): No error clause found', true, false));
      awaitWrapperExpr.comments = comments;
    }

    // everything after `if-else` also goes after await call
    afterAwaitExprs = afterAwaitExprs.concat(callbackFn.body.body);

    const tryStatement = j.tryStatement(
      j.blockStatement([awaitWrapperExpr, ...afterAwaitExprs].filter(Boolean)),
      j.catchClause(firstParam, null, catchBody),
    );
    return tryStatement;
  };

  return root.find(j.CallExpression).filter(hasCallback).replaceWith(awaitFn).toSource();
};
