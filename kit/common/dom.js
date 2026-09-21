// Utils related to DOM elements
{
    // Append a resource in the document body
    // Return a Promise which is fulfilled once resource is loaded
    // Resolved value is the element
    function addResource(path, type="script") {
        let p = new Promise((resolve, reject) => {
            let resource = document.createElement(type);
            resource.src = path;
            resource.async = false;
            resource.defer = false;
            resource.onload = () => resolve(resource);
            resource.onerror = () => reject("[-] Failed to load " + path);
            document.body.appendChild(resource);
        });
        return p;
    }


    // Ensure that all elements in the document body are loaded
    function waitElementsLoaded() {
        async function onload(img, resolve) {
            if (document.body.lastChild != img) {
                await waitElementsLoaded();
            }
            document.body.removeChild(img);
            resolve();
        }

        return new Promise((resolve) => {
            let img = document.createElement("img");
            img.src = window.location;  // this should be cached and won't make a new request
            img.async = false;
            img.defer = false;
            img.style.display = "none";
            img.onload = () => onload(img, resolve);
            img.onerror = () => onload(img, resolve);
            document.body.appendChild(img);
        });
    }
}
