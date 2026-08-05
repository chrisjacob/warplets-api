const SEARCH_URL = "https://search.10x.meme/tabs?display=popup&source=10x-tabs";

chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: SEARCH_URL,
    type: "popup",
    width: 440,
    height: 780,
    focused: true,
  });
});
