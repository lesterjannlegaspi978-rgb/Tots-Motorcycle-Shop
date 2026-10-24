(function () {
    var token = localStorage.getItem("authToken");

    if (!token) {
        window.location.replace("login.html");
        return;
    }

    var originalFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var sameOrigin = !/^https?:\/\//i.test(url) || url.indexOf(window.location.origin) === 0;

        init = init || {};

        if (sameOrigin) {
            var headers = new Headers(init.headers || {});
            headers.set("Authorization", "Bearer " + localStorage.getItem("authToken"));
            init.headers = headers;
        }

        return originalFetch(input, init).then(function (response) {
            if (sameOrigin && response.status === 401) {
                localStorage.removeItem("authToken");
                window.location.replace("login.html");
            }

            return response;
        });
    };
})();

window.logoutUser = function () {
    localStorage.removeItem("authToken");
    window.location.replace("login.html");
};