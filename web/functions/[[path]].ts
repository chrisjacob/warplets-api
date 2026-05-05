export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);

  if (url.hostname === "www.10x.meme") {
    url.hostname = "10x.meme";
    return Response.redirect(url.toString(), 302);
  }

  return context.next();
};
