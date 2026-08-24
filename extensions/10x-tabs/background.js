const WARPLETS_URL = "https://warplet.10x.meme/tabs?display=popup&source=10x-tabs";

chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: WARPLETS_URL,
    type: "popup",
    width: 440,
    height: 780,
    focused: true,
  });
});
