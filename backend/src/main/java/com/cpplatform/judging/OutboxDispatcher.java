package com.cpplatform.judging;

import com.cpplatform.common.Database;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.slf4j.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

@Component
@ConditionalOnProperty(name="cp.dispatch.enabled",havingValue="true",matchIfMissing=true)
public class OutboxDispatcher {
    private static final Logger LOG=LoggerFactory.getLogger(OutboxDispatcher.class);
    private final Database db;private final RabbitTemplate rabbit;private final TransactionTemplate tx;
    public OutboxDispatcher(Database db,RabbitTemplate rabbit,org.springframework.transaction.PlatformTransactionManager manager) {
        this.db=db;this.rabbit=rabbit;this.tx=new TransactionTemplate(manager);
    }
    @Scheduled(fixedDelayString="${cp.dispatch.delay-ms:250}")
    public void dispatch() {
        UUID claim=UUID.randomUUID();
        var batch=tx.execute(status->db.jdbc.queryForList("WITH pending AS (SELECT id FROM judge_outbox WHERE published_at IS NULL AND available_at<=now() AND (claim_expires_at IS NULL OR claim_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 8) UPDATE judge_outbox o SET claim_token=?,claim_expires_at=now()+interval '120 seconds',attempts=attempts+1 FROM pending p WHERE o.id=p.id RETURNING o.*",claim));
        if(batch==null)return;
        for(var event:batch) {
            UUID id=(UUID)event.get("id");
            try {
                var job=db.one("SELECT s.language_code FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=?",event.get("job_id"));
                String key=event.get("lane").toString().toLowerCase(Locale.ROOT)+"."+job.get("language_code");
                String payload="{\"jobId\":\""+event.get("job_id")+"\",\"dispatchSequence\":"+event.get("dispatch_sequence")+"}";
                MessageProperties properties=new MessageProperties();properties.setContentType("application/json");
                properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);properties.setMessageId(id.toString());
                CorrelationData correlation=new CorrelationData(UUID.randomUUID().toString());
                rabbit.send(JudgeConfiguration.EXCHANGE,key,new Message(payload.getBytes(StandardCharsets.UTF_8),properties),correlation);
                var confirm=correlation.getFuture().get(5,TimeUnit.SECONDS);
                if(!confirm.isAck() || correlation.getReturned()!=null) throw new IllegalStateException("Broker rejected dispatch");
                db.jdbc.update("UPDATE judge_outbox SET published_at=now(),claim_token=NULL,claim_expires_at=NULL WHERE id=? AND claim_token=?",id,claim);
            } catch(Exception failure) {
                db.jdbc.update("UPDATE judge_outbox SET available_at=now()+interval '5 seconds',claim_token=NULL,claim_expires_at=NULL WHERE id=? AND claim_token=?",id,claim);
                LOG.warn("Judge dispatch postponed for outbox {}",id);
            }
        }
    }
}
