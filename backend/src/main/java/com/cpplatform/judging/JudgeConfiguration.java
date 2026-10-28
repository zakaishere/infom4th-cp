package com.cpplatform.judging;

import org.springframework.context.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import java.util.*;
import org.springframework.amqp.core.Queue;

@Configuration
@ConditionalOnProperty(name="cp.dispatch.enabled",havingValue="true",matchIfMissing=true)
public class JudgeConfiguration {
    public static final String EXCHANGE="cp.judge";
    public static final List<String> LANGUAGES=List.of("CPP","CPP20","C","JAVA","PYTHON","PYPY","JAVASCRIPT","GO","RUST","KOTLIN","CSHARP","RUBY","PHP");
    @Bean Declarables judgeTopology() {
        List<Declarable> declarations=new ArrayList<>();
        DirectExchange exchange=new DirectExchange(EXCHANGE,true,false),dead=new DirectExchange("cp.judge.dead",true,false);
        Queue dlq=QueueBuilder.durable("cp.judge.dead").quorum().build();
        declarations.add(exchange);declarations.add(dead);declarations.add(dlq);
        declarations.add(BindingBuilder.bind(dlq).to(dead).with("dead"));
        for(String lane:List.of("official","internal")) for(String language:LANGUAGES) {
            String key=lane+"."+language;
            Queue queue=QueueBuilder.durable("cp.judge."+key).quorum()
                    .deadLetterExchange("cp.judge.dead").deadLetterRoutingKey("dead").build();
            declarations.add(queue);declarations.add(BindingBuilder.bind(queue).to(exchange).with(key));
        }
        return new Declarables(declarations);
    }
    @Bean RabbitTemplate judgeRabbitTemplate(ConnectionFactory connection) {
        RabbitTemplate template=new RabbitTemplate(connection);template.setMandatory(true);return template;
    }
}
