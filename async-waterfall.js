module.exports = (file, { jscodeshift: j }) {
  const { isFnNode, hasCallback, awaitFn, filterImmediateFns, removeWrapperFn, convertParentFnAsync, createBlockStatement, removeWrappingParenthesis } = getFns(j);

  return j(file.source)
    .find(j.CallExpression, {
      callee: {
        object: {
          name: "async"
        },
        property: { name: "waterfall" }
      }
    })
    .forEach((wf) => {
      const wfFns = j(wf.node.arguments[0]);
      wfFns
        .find(j.CallExpression)
        .filter(hasCallback)
        .forEach(awaitFn({ tryCatch: true }));
      wfFns.find(j.FunctionExpression).filter(filterImmediateFns).replaceWith(removeWrapperFn);
      wfFns.find(j.ArrowFunctionExpression).filter(filterImmediateFns).replaceWith(removeWrapperFn);
      j(wf)
        // convert async.waterfall's 2nd argument to await
        .forEach(awaitFn({ tryCatch: false }))
        .replaceWith((p) => {
          // remove async.waterfall wrapper
          const wfBody = p.node.arguments;
          const asyncWaterfallFns = wfBody.shift();

          // if it's an assignment then we get nodes from `asyncWaterfallFns.expression.right` if not it will be variable declaration
          const fns = asyncWaterfallFns.elements || (asyncWaterfallFns.expression ? asyncWaterfallFns.expression.right : asyncWaterfallFns.declarations[0].init).argument.arguments[0].elements;
        const x = createBlockStatement(fns.concat(wfBody));
          return x
        });

      // remove the async.waterfall() contents from block statement
      // and insert it in parent's body
       // removeWrappingParenthesis(wf, wf.node.body);
    })
    .toSource();
}

// hoisting and definiing fns at the end so i don't have to keep scrolling down
function getFns(j) {
  const isFnNode = (n) => ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(n.type);
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

    let isThenCatchPromise;
    try {
      isThenCatchPromise = ["then", "catch"].includes(node.callee.property.name);
    } catch (e) {
      isThenCatchPromise = false;
    }

    let isEventHandler;
    try {
      isEventHandler = node.callee.property.name === "on";
    } catch (e) {
      isEventHandler = false;
    }

    const isWithinAsync = j(p).closest(j.CallExpression, isAsyncLibraryNode).size() > 0;

    // we do not transform all nodes within async.waterfall()
    // we also do not want to transform then-catch promises
    return _hasCallback && !isWithinAsync && !isThenCatchPromise && !isEventHandler;
  };

  const createBlockStatement = (contents) => {
    // when j.blockStatement(contents) won't work
    const block = j.blockStatement([]);
    block.body = contents || []; // call me a hackerman
    return block;
  };

  const convertParentFnAsync = (p) => {
    let parent = p.parent;
    while (parent) {
      if (isFnNode(parent.node)) {
        parent.node.async = true;
        break;
      }
      parent = parent.parent;
    }
    return parent;
  };

  const removeWrappingParenthesis = (p, replacementContents) => {
    const parentNode = p.parent.node;
    const grandparentNodeBody = p.parent.parent.node.body;
    const parentNodePosition = grandparentNodeBody.indexOf(parentNode);

    // remove parentNode and replace it with `removeWrappingParenthesis`
    grandparentNodeBody.splice(parentNodePosition, 1, ...replacementContents);
  };

  const addComment = (node, comment) => {
    const comments = node.comments || [];
    comments.push(j.commentLine(" TODO(codemods): No error clause found", true, false));
    node.comments = comments;
  };

  const awaitFn = ({tryCatch}) => (p) => {
    // ensure parent function is converted to an `await` fn
    const parent = convertParentFnAsync(p);

    // the CallExpression's arguments
    const argLen = p.node.arguments.length;
    // popping the last arg as its the callback fn
    const callbackFn = p.node.arguments.pop();
    const cbParams = callbackFn.params;

    // get the error identifier
    const firstParam = cbParams.shift();
    const returnValuesCount = cbParams.length;
    const hasReturnValue = !!returnValuesCount;

    // check if there is an if statement checking for error
    const firstCbExpr = callbackFn.body.body[0];
    const hasCatchClause = firstCbExpr.type === "IfStatement" && firstCbExpr.test.type === "Identifier" && firstCbExpr.test.name === firstParam.name;
    // if there is, then all it's contents go to the body of `catch` clause
    const catchBody = hasCatchClause ? firstCbExpr.consequent : j.blockStatement([]);

    // create await expression
    const awaitExpression = j.awaitExpression(j.callExpression(p.node.callee, p.node.arguments));
    const expressionStatement = j.expressionStatement(awaitExpression);

    // if more than 1 values then destructure variables from an
    const variableDeclaratorId = returnValuesCount > 1 ? j.arrayPattern(cbParams) : cbParams[0];

    // if it is returning a value declare the variable(s)
    // if it has a try-catch block, declare the variable outside the blocks and assign the return value
    const variablesAssignment = j.expressionStatement(j.assignmentExpression("=", variableDeclaratorId, awaitExpression));
    const variablesDeclaration = j.variableDeclaration("let", [j.variableDeclarator(variableDeclaratorId, awaitExpression)]);
    const awaitWrapperExpr = hasReturnValue ? (hasCatchClause ? variablesAssignment : variablesDeclaration) : expressionStatement;

    let afterAwaitExprs = [];

    // if the catch clause is found then everything inside `else` will go below await statement
    if (hasCatchClause) {
      // if the alternate an else-if then we have to concat `firstCbExpr.alternate` else it will be a blockStatement so concat `firstCbExpr.alternate.body`
      afterAwaitExprs = afterAwaitExprs.concat(firstCbExpr.alternate ? firstCbExpr.alternate.body || firstCbExpr.alternate || [] : []);
      // remove the `if-else`
      callbackFn.body.body.shift();
    } else {
      addComment(awaitWrapperExpr, " TODO(codemods): No error clause found");
    }

    // everything after `if-else` also goes after await call
    afterAwaitExprs = afterAwaitExprs.concat(callbackFn.body.body);
    const tryContents = createBlockStatement([awaitWrapperExpr, ...afterAwaitExprs]);
    const tryStatement = j.tryStatement(tryContents, j.catchClause(firstParam, null, catchBody));

    // when tryContents is false, ideally we should be returning tryContents.body but
    // there is no way to do it so attaching it to parent fn's body
    if (tryCatch && hasCatchClause) {
      const x = createBlockStatement([j.variableDeclaration("let", [j.variableDeclarator(variableDeclaratorId)]), tryStatement]);
      removeWrappingParenthesis(p, x.body);
    } else {
      removeWrappingParenthesis(p, tryContents.body);
    }
  };

  const filterImmediateFns = (p) => p.parent.node.type === "ArrayExpression";
  const removeWrapperFn = (p) => {
    const params = p.node.params;
    // get fn's last arg, most cases it will be `next`
    const lastParam = p.node.params[params.length - 1];

    j(p.node.body)
      .find(j.IfStatement, { consequent: { type: "ReturnStatement", argument: { type: "CallExpression", callee: { name: lastParam.name } } } })
      .forEach((p) => {
        const ifParentBody = p.parent.node.body;
        const ifIndex = ifParentBody.indexOf(p.node);
        const everythingAfterIf = ifParentBody.splice(ifIndex + 1, ifParentBody.length);
        p.node.test = j.unaryExpression("!", p.node.test, true); // negate the if's test
        p.node.consequent = createBlockStatement(everythingAfterIf);
      });

    const formattedBody = j(p.node.body)
      // find all next() calls
      .find(j.ExpressionStatement, { expression: { callee: { name: lastParam.name } } })
      .replaceWith((p) => {
        const cbHandlerArgs = p.node.expression.arguments;
        const argsLength = cbHandlerArgs.length;
        if (argsLength === 0) return null;

        let replacementNode = null;
        const errorArg = cbHandlerArgs[0];
        // TODO(harsilspatel): handle return next(err, <>) instances
        // if it is like next(<singleParam>) then it likely is an error
        if (argsLength === 1 && !(errorArg.type === "Literal" && errorArg.value === null)) {
          replacementNode = j.throwStatement(errorArg);
        } else if (argsLength === 1) {
          // if it's next(null) then simply remove it
          replacementNode = null;
        } else {
          // return single argument or return array of multiple elements
          // remove error from return
          //  cbHandlerArgs.shift(); // argsLength length changes here
          //  replacementNode = j.returnStatement(cbHandlerArgs.length === 1 ? cbHandlerArgs[0] : j.arrayExpression(cbHandlerArgs));
          replacementNode = null;
        }
        // replacing parent as it's an ExpressionStatement i.e. one that ends with a semi-colon
        return replacementNode;
      });

    // remove the stuff from fn body
    return p.node.body.body;
  };

  return {
    isFnNode,
    hasCallback,
    awaitFn,
    createBlockStatement,
    filterImmediateFns,
    removeWrapperFn,
    convertParentFnAsync,
    removeWrappingParenthesis
  };
}

function c () {
  console.log
}

/*
TODO handle async.waterfall() scenarios like:
function completed(err, project, attendant) {
      if (err) {
        console.log("shiz");
        return callback(err);
      }
      return callback(null, true, {
        project,
        attendant,
        attendantId,
        strategy: common.AUTH_STRATEGY_KONG,
      });
    },
  );

1. should not overwrite "shiz"
2. should be able to return instead of callback(<>, <>, <>)
*/