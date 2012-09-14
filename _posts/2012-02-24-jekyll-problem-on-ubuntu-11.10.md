---
title: Jekyll problem on Ubuntu 11.10
layout: post
---

Hi,

I had a problem with jekyll on ubuntu 11.10 when I wanted to run the jekyll server:

{% highlight bash %}
$ jekyll --server
Invalid gemspec in [/var/lib/gems/1.8/specifications/directory_watcher-1.4.1.gemspec]: invalid date format in specification: "2011-08-30 00:00:00.000000000Z"
{% endhighlight %}

To fix this issue, edit the `directory_watcher-1.4.1.gemspec` file:

{% highlight bash %}
$ [sudo] emacs -nw /var/lib/gems/1.8/specifications/directory_watcher-1.4.1.gemspec
{% endhighlight %}

and change `s.date = %q{2011-08-30 2011-08-30 00:00:00.000000000Z}` to `s.date = %q{2011-08-30}`