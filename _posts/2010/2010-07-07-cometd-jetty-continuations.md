---
layout: post
title: Cometd & Jetty Continuations
categories:
- Programming
tags:
- Java
- Jetty
- Cometd
---

> 前言：随着web的不断发展，出现了诸如ajax，comet等技术，其实都是为了提高用户体验。在web并发量越来越高的今天，异步成了一个热点。servlet3.0也引入了异步处理的概念。

Comet是一种服务器端推的技术，所谓服务器端推也就是当有事件要通知给某个用户的时候，是由服务器端直接发送到用户的浏览器。
服务器端Push目前一般有两种方式，HTTP streaming和Long polling。详细的介绍可以看这里 http://en.wikipedia.org/wiki/Push_technology

有一个Comet的框架叫做Cometd，使用的方式为Long polling。它是使用了jetty continuations特性，jetty continuations使得异步的request成为可能，这里我们来讨论下为何需要jetty continuations呢？

比如我们的浏览器的一个请求发送到服务器端了，并进行长轮询，保持了连接不结束，直到一次长轮询timeout或者有事件发生，并接收到服务端推来的消息，所以在一次长轮询的过程中，大部分时间都是在等待，如果使用老式同步的方式进行编程的话，那么有多少个连接就需要多少个线程在那里，而大都数都是在等待，所以这无疑是系统资源的巨大浪费。
jetty continuations很好的解决了这一问题，当有请求过来之后，将连接的相关信息封装到一个continuation的对象中，通过调用continuation的suspend方法，然后返回，把当前线程交还到线程池，所以这个时候线程可以返回到线程池等待并处理其他新的请求。
当有事件要发给之前的某个请求的时候，再调用对应的continuation的resume方法，将原来的哪个请求重新发送到servelt进行处理，并将消息发送给客户端，然后客户端会重新进行一次长轮询。

下面我来由上而下详细讲述jetty continuation实现方式

## 一.Cometd

Cometd是一个Comet的框架，实现方式为基于jetty continuation的长轮询。
Cometd的消息都基于一个叫做Bayeux的消息协议

Bayeux的主要目的是支持使用ajax的客户端与服务器端之间灵敏，快速的信息交互。

Bayeux是一种用来在客户端和服务器端传输低延迟的异步消息（主要通过http）的一种协议。它定义的消息通过命名通道进行路由并且能够进行交互传 送：server -> client, client -> server 甚至 client -> client （当然还是需要通过server中转）。默认的，此通道已经引用了发布的路由语义，但同时也支持其它路由模块。

从服务器端向客户端异步发送的数据通常被叫做 “服务器推”（server-push）。这种使用ajax的web应用和服务器推技术的结合称作“Comet”。 Cometd是一个提供多种开发语言的Bayeux项目，由Dojo基金会提供支持。

### 1.Cometd Server

在服务器端推中，一个常见的应用场景便是，消息的生产者可以往一些消息channel中通过bayeux协议发送消息，服务器端对bayeux消息进行处理解析，发送到所有订阅了这个channel的消息消费者，消费者接收到这个消息之后便可以自己再做自己的处理。在这样的模型中于是出现了几个重要的概念：  

Bayeux  
这个在cometd框架中是ContinuationBayeux类，
bayeux对象在cometd运行的上下文中非常重要，可以说是一个核心对象，它管理着所有的clients和channel，并肩负着消息的处理和维护。
channel在cometd中是一个树形的结构，在bayeux对象中，保存着根channel（/），从根channel我们可以找到它的子channel
bayeux存在一个handle方法，对消息进行处理  
  
Client  
一个client对应着一个消息的生产者或者消费者，对应的类为ContinuationClient。
client中包含一个contiunation对象，以及对continuation对象进行操作的suspend和resume的方法
subscriptions保存着当前client的所有订阅的频道channel
client由一个clientId唯一标示，每一个client还对应着一个browserId。
client可以通过deliver方法来进行接受消息操作，接受消息无非就是将接收到的消息加入到自己的消息队列中，并将continuation对象进行resume，这样之前冻结的request重新发送到servlet进行处理。  
  
Channel  
channel在cometd中对应ChannelImpl类
channel中维护这一个subscribers的列表，用来保存订阅了当前channel的订阅者
channel还维护者自己的子channel
每一个channel都对应这一个channelId 也就是channel的路径字符串  
  
ContinuationCometdServlet
Cometd Server运行时的入口为ContinuationCometdServlet  
  
Handshake  
客户端和服务器端建立连接之前需要先握手，在服务器端将客户端标识起来。一个请求过来如果cookie中没有broswer_id那么就生成一个broswer_id(相当于session_id 因为这些请求并非无状态的，需要在多次长轮询中记住请求是来自同一个客户端),并写到cookie中。握手的时候还会生成一个ContinuationClient对象，每一个ContinuationClient对象由一个client_id唯一标识。并在握手成功后将这个clientId作为消息的一部分发给客户端。由于握手的消息是属于元数据消息，所以在Bayeux中提供了所有元消息channel的Handler。这些handler最终将消息交给各种Transport去发送，Tranport对象 此类对象主要是用来处理消息的发送，比如JSONTransport或者JSONPTransport，这两个对象中都有response的引用，所以可以用来直接回复客户端。  
  
Subscribe  
订阅的主要作用是将订阅某个Channel的客户端所对应的ContinuationClient对象加入到对应的channel的subscribers列表中，并将所订阅的channel加入到ContinuationClient对象的subscriptions数组中。订阅成功之后就应该开始了long-pooling了，这个时候，服务器端会将当前的请求封装到一个Continuation中，并将Continuation对象设到ContinuationClient对象中，然后将ContinuationClient对象suspend，让出当前处理线程。  
  
Publish  
当一个客户端往一个channel中publish消息的时候，服务器端接收到这个message，有两种方式处理这个消息，一个是在相应的channel中广播这个消息，这个时候调用channel的push方法，对每一个订阅了当前channel及其子channel中的ContinuationClient进行消息分发，将消息复制到每一个ContinuationClient自己的消息队列中，并将ContinuationClient中的Continuation唤醒resume。这个时候之前暂停的request会被重新发送到servlet，并且servlet可以知道其状态，并进行消息的处理。还有一种消息的发送是直接调用某个ContinuationClient对象进行消息的发送。  
  
### 2.Cometd Client

上面讲了服务器端的各种情况的处理，当然光有服务器端的处理是没有用的，还需要客户端的配合。
客户端既可以是后端的java程序，更多的时候是浏览器。
浏览器中采用Ajax的方式和服务器进行交互，cometd提供了基于dojo和jquery两个js框架的cometd-client

## 二.Jetty NIO & Continuation

在Cometd部分提及到当服务器端接收到来自客户端发来的消息，然后对消息进行处理。当然在web应用中，消息的接受最初都是由web容器来接受，这涉及到了socket的处理，这个时候web容器本身的io性能就非常重要了。
在传统的BIO服务器模型中，一个新的连接来了，就要创建一个线程来接受这个socket连接（一个连接一个线程），进行简单的封装后，分发给web容器的”线程池“，线程池会选择一个线程来处理连接请求并给予响应。
而在NIO的模型中，只需要一个线程便可以处理所有的连接，当有新的连接建立的时候，只需要将连接注册到selector中，直到某次检测到有请求了，便开始对请求进行处理，并将他们都交给”线程池“（所有的连接都是一个线程在处理，直到发现了请求，再将请求分发出去）。
在高效的Comet应用的最底层还需要一个高效的web容器。

### 1.Jetty Server With NIO
 
Jetty是一个纯java实现的非常轻量级的web容器，高度组件化，可以很方便的将各种组件进行组装，而且可以非常容易的将jetty嵌入到自己的应用中。
jetty运行时的核心类是Server类，这个类的配置一般在jetty.xml中配置，然后jetty自带的一个简单的ioc容器将server加载初始化。
下图主要描述了Jetty在NIO的模式下工作的情形，这里只说到将任务分配到ThreadPool，后面的ThreadPool的处理没有说，大家可以去看下源码。

![Jetty](http://farm8.staticflickr.com/7115/7076600691_0b07e3c8ea_z_d.jpg)

在jetty中，web容器启动是从Server开始的，一个Server可以对应多个Connector，从名字就可以知道，Connector是来处理外部连接的，Connector的实现有多种，即可以是非阻塞的（如SelectChannelConnector），也可以是阻塞的（如BlockingChannelConnector，当然jetty中这个阻塞的已经使用nio优化过，性能应该比使用java io实现的好），
我们不能直接说谁的性能好，谁的性能不好，关键还是看应用场景，因为NIO实现的非阻塞的话，doSelect的过程是阻塞的。所以当并发量小，且请求可以快速得到响应的话，用阻塞的就可以很好的满足了，但是当并发量很大，且后端资源紧张，请求需要等待很长一段时间的（比如长轮询），那么NIO的性能肯定必传统的高很多很多倍。
这里稍微讲一下NIO的概念把，在NIO的Scoket通讯模型中，一个socket连接对应一个SocketChannel，SocketChannel可以将某个事件注册到某一个Selector上，然后对Selector进行select操作，当有请求来的时候，并可以通过Selector的selectedKeys()获得所有收到事件的channel，然后便可以对channel进行操作了。这个其实和linux中的select函数类似，只不过这里是面向对象的，在linux中，我们将需要监听的sockt连接加入到一个文件描述符的集合中FD_SET中，然后select函数对这个集合进行检测，根据得到的结果来判断某个fd对应的标志位是否为1来判断是否有数据。这样也就是一个线程可以同事处理多个连接。

换话题了，我们都知道请求最终都是在Servlet中被处理的，而Servlet得到的是request，response，这些对象什么时候出来的呢？不急，上面不是说到一个EndPoint（实现了Runnable接口）EndPoint对象在被初始化的时候就对其_connection成员进行了初始化，生成一个HttpConnection对象，newConnection的方法其实在SelectChannelConnector中被覆盖了。然后这个EndPoint对象不是被分配到ThreadPool了么，ThreadPool将其加入到队列中，当有空闲线程的时候，就对这个endPoint对象进行处理了，运行EndPoint的run方法,然后会调用自己的connection对象的handle方法，最终将connection对象交给Server的handler进行处理。Server本身继承自HandlerWrapper，自己的_handler是一个HandlerCollection的实例，HandlerCollection实例的配置在jetty.xml中有配置，在处理httpconnection对象的时候所配置的handler会依次被执行。
DefaultHandler中就涉及到上下文处理，然后交给各个项目的servlet进行处理。

### 2.Jetty Continuation

Jetty Continuation在jetty7的实现中也就8个类，非常的简洁。
ContinuationSupport类是产生Continuation对象的工厂类。它会根据当前服务器容器的类型选择不同类型的Continuation对象，比如支持jetty6版本的，还有支持servlet3.0版本（对servlet3.0异步处理进行了封装），还有一个阻塞的Continuation实现FauxContinuation。