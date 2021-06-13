// Press ctrl+space for code completion
export default function transformer(file, api) {
  const j = api.jscodeshift;

  return j(file.source)
    .find(j.MemberExpression, {
      object: { name: "async" },
      property: { name: "waterfall" }
    })
    .forEach((waterfallNode) => {
      j(waterfallNode).find();
    })
    .toSource();
}
