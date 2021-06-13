// Press ctrl+space for code completion
export default function transformer(file, api) {
  const j = api.jscodeshift;

  return (
    j(file.source)
      .find(j.CallExpression)
      .filter((p) => {
        try {
          const argLen = p.node.arguments.length;
          const lastArg = p.node.arguments[argLen - 1];
          // console.log(lastArg.params[0].name);
          return (
            ["FunctionExpression", "ArrowFunctionExpression"].includes(lastArg.type) && lastArg.params.length <= 2 && ["e", "err", "error", "formattedError"].includes(lastArg.params[0].name)
          );
        } catch (e) {
          return false;
        }
      })
      // .forEach((p) => console.log(p.parent))
      .replaceWith((p) => {
        let parent = p.parent;
        while (parent) {
          // console.log(parent.node);
          if (["FunctionExpression", "ArrowFunctionExpression"].includes(parent.node.type)) {
            parent.node.async = true;
            break;
          }
          parent = parent.parent;
        }

        const argLen = p.node.arguments.length;
        const callbackFn = p.node.arguments.pop();
        const cbParams = callbackFn.params;
        const hasReturnValue = callbackFn.params.length === 2;
        // console.log("callbackFn", callbackFn.body.body[0]);

        const firstCbExpr = callbackFn.body.body[0];
        const hasCatchClause = firstCbExpr.type === "IfStatement" && firstCbExpr.test.type === "Identifier" && firstCbExpr.test.name === cbParams[0].name;
        const catchBody = hasCatchClause ? firstCbExpr.consequent : j.blockStatement([]);

        const awaitExpression = j.awaitExpression(j.callExpression(p.node.callee, p.node.arguments));
        const expressionStatement = j.expressionStatement(awaitExpression);
        const awaitWrapperExpr = hasReturnValue ? j.variableDeclaration("let", [j.variableDeclarator(cbParams[1], awaitExpression)]) : expressionStatement;

        let afterAwaitExprs = [];
        if (hasCatchClause) {
          afterAwaitExprs = afterAwaitExprs.concat(firstCbExpr.alternate ? firstCbExpr.alternate.body : []);
          callbackFn.body.body.shift();
        } else {
          const comments = awaitWrapperExpr.comments || [];
          comments.push(j.commentLine(" TODO(codemods): No error clause found", true, false));
          awaitWrapperExpr.comments = comments;
          console.log(awaitWrapperExpr);
        }

        const tryStatement = j.tryStatement(j.blockStatement([awaitWrapperExpr, ...afterAwaitExprs, ...callbackFn.body.body]), j.catchClause(cbParams[0], null, catchBody));
        return tryStatement;
      })
      .toSource()
  );
}
