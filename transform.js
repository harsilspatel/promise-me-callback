// Press ctrl+space for code completion
export default function transformer(file, api) {
  const j = api.jscodeshift;
  const { isFnNode, hasCallback, awaitFn, filterImmediateFns, removeWrapperFn } = getFns(j);

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
      //    j(wf).replaceWith((p) => {
      //      console.log("p", p.node);
      //    });
      //     return;

      const wfFns = j(wf.node.arguments[0]);
      wfFns
        .find(j.CallExpression)
        .filter(hasCallback)
        .replaceWith(awaitFn({ tryCatch: false }));
      console.log("wf.node", wf.node);
      wfFns.find(j.FunctionExpression).filter(filterImmediateFns).replaceWith(removeWrapperFn);
      wfFns.find(j.ArrowFunctionExpression).filter(filterImmediateFns).replaceWith(removeWrapperFn);
      j(wf).replaceWith(awaitFn({ tryCatch: true }));
      // .replaceWith((p) => {
      //   console.log("p", p.node);
      // });

      // wfFns.forEach((fn) => j(fn).map(removeWrapperFn));
    })
    .toSource();
}

// hoisting and definiing fns at the end so i don't have to keep scrolling down
function getFns(j) {
  function toArray(value) {
    return Array.isArray(value) ? value : [value];
  }
  const isFnNode = (n) => ["FunctionExpression", "ArrowFunctionExpression"].includes(n.type);
  const hasCallback = (p) => {
    try {
      const argsLen = p.node.arguments.length;
      const lastArg = p.node.arguments[argsLen - 1];
      return isFnNode(lastArg) && ["e", "err", "error", "formattedError"].includes(lastArg.params[0].name);
    } catch (e) {
      return false;
    }
  };

  const awaitFn = ({ tryCatch }) => (p) => {
    // ensure parent function is converted to an `await` fn
    let parent = p.parent;
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
    const firstCbExpr = callbackFn.body.body[0];
    const hasCatchClause = firstCbExpr.type === "IfStatement" && firstCbExpr.test.type === "Identifier" && firstCbExpr.test.name === firstParam.name;
    // if there is, then all it's contents go to the body of `catch` clause
    const catchBody = hasCatchClause ? firstCbExpr.consequent : j.blockStatement([]);

    // create await expression
    const awaitExpression = j.awaitExpression(j.callExpression(p.node.callee, p.node.arguments));
    const expressionStatement = j.expressionStatement(awaitExpression);

    // if more than 1 values then destructure variables from an
    const variableDeclaratorId = returnValues > 1 ? j.arrayPattern(cbParams) : cbParams[0];
    // if it is returning a value declare the variable
    const awaitWrapperExpr = hasReturnValue ? j.variableDeclaration("let", [j.variableDeclarator(variableDeclaratorId, awaitExpression)]) : expressionStatement;

    let afterAwaitExprs = [];

    // if the catch clause is found then everything inside `else` will go below await statement
    if (hasCatchClause) {
      afterAwaitExprs = afterAwaitExprs.concat(firstCbExpr.alternate ? firstCbExpr.alternate.body : []);
      // remove the `if-else`
      callbackFn.body.body.shift();
    } else {
      const comments = awaitWrapperExpr.comments || [];
      comments.push(j.commentLine(" TODO(codemods): No error clause found", true, false));
      awaitWrapperExpr.comments = comments;
    }

    // everything after `if-else` also goes after await call
    afterAwaitExprs = afterAwaitExprs.concat(callbackFn.body.body);

    const tryContents = j.blockStatement([awaitWrapperExpr, ...afterAwaitExprs]);
    console.log("tryContents", tryCatch, tryContents);
    const tryStatement = j.tryStatement(tryContents, j.catchClause(firstParam, null, catchBody));
    return tryCatch ? tryStatement : tryContents;
  };

  const filterImmediateFns = (p) => p.parent.node.type === "ArrayExpression";
  const removeWrapperFn = (p) => {
    const params = p.node.params;
    // get fn's last arg, most cases it will be `next`
    const lastParam = p.node.params[params.length - 1];

    const formattedBody = j(p.node.body)
      // find all next() calls
      .find(j.ExpressionStatement, { expression: { callee: { name: lastParam.name } } })
      .replaceWith((p) => {
        const errorArg = p.node.expression.arguments[0];

        // if it is like next(something) then it likely is an error
        if (p.node.expression.arguments.length === 1 && !(errorArg.type === "Literal" && errorArg.value === null)) {
          return j.throwStatement(errorArg);
        } else {
          // else don't replace it with anything
          return null;
        }
      });

    j(p).replaceWith((p) => {
      console.log("just collection", p.node);
      return p.node.body;
    });
    console.log("after");

    return p.node.body;
  };

  return {
    isFnNode,
    hasCallback,
    awaitFn,
    filterImmediateFns,
    removeWrapperFn
  };
}
