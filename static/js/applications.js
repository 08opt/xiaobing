$('*[rel=tooltip]').tooltip();

$('.nav li a').each(function() {
    var location = window.location.pathname;
    if (location.substr(-1) == '/' && location.length > 1) {
	var location = location.slice(0, -1);
    }

    if ($(this).attr("href") == location) {
        $(this).parent().addClass('active')
    }
});

$('a[href=#top]').click(function() {
    $('html, body').animate({scrollTop:0}, 'slow');
    return false;
});

$('.btn-group .disabled').removeAttr('href');
