package com.cpplatform.analytics;

import com.cpplatform.common.Database;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.stereotype.Component;
import javax.sql.DataSource;
import java.io.File;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.util.*;

/**
 * Live readings of the API host. Inside a container the JVM reports the container's
 * CPU and memory limits, not the whole machine's.
 */
@Component
public class ServerMetrics {
    private final Database db;private final DataSource dataSource;
    public final String host=hostName();
    public ServerMetrics(Database db,DataSource dataSource){this.db=db;this.dataSource=dataSource;}

    private static String hostName() {
        try {return InetAddress.getLocalHost().getHostName();} catch(Exception e) {return "backend";}
    }
    private static Double ratio(double value){return value<0||Double.isNaN(value)?null:Math.round(value*1000)/1000.0;}
    private static long mb(long bytes){return bytes/(1024*1024);}

    public Map<String,Object> snapshot() {
        var result=new LinkedHashMap<String,Object>();
        var runtime=ManagementFactory.getRuntimeMXBean();var memory=ManagementFactory.getMemoryMXBean();
        var base=ManagementFactory.getOperatingSystemMXBean();
        result.put("host",host);
        result.put("cpus",base.getAvailableProcessors());
        result.put("loadAverage",base.getSystemLoadAverage()<0?null:base.getSystemLoadAverage());
        if(base instanceof com.sun.management.OperatingSystemMXBean os) {
            result.put("systemCpu",ratio(os.getCpuLoad()));
            result.put("processCpu",ratio(os.getProcessCpuLoad()));
            result.put("memoryTotalMb",mb(os.getTotalMemorySize()));
            result.put("memoryUsedMb",mb(os.getTotalMemorySize()-os.getFreeMemorySize()));
            result.put("swapTotalMb",mb(os.getTotalSwapSpaceSize()));
            result.put("swapUsedMb",mb(os.getTotalSwapSpaceSize()-os.getFreeSwapSpaceSize()));
        }
        var heap=memory.getHeapMemoryUsage();
        result.put("heapUsedMb",mb(heap.getUsed()));
        result.put("heapMaxMb",mb(heap.getMax()>0?heap.getMax():heap.getCommitted()));
        result.put("nonHeapUsedMb",mb(memory.getNonHeapMemoryUsage().getUsed()));
        result.put("threads",ManagementFactory.getThreadMXBean().getThreadCount());
        result.put("uptimeSeconds",runtime.getUptime()/1000);
        result.put("startedAt",new Date(runtime.getStartTime()).toInstant().toString());
        result.put("javaVersion",System.getProperty("java.version"));
        long gcCount=0,gcMillis=0;
        for(var gc:ManagementFactory.getGarbageCollectorMXBeans()){gcCount+=Math.max(0,gc.getCollectionCount());gcMillis+=Math.max(0,gc.getCollectionTime());}
        result.put("gcCount",gcCount);result.put("gcMillis",gcMillis);
        File disk=new File(".").getAbsoluteFile();
        result.put("diskTotalMb",mb(disk.getTotalSpace()));
        result.put("diskFreeMb",mb(disk.getUsableSpace()));
        if(dataSource instanceof HikariDataSource hikari && hikari.getHikariPoolMXBean()!=null) {
            var pool=hikari.getHikariPoolMXBean();
            result.put("pool",Map.of("active",pool.getActiveConnections(),"idle",pool.getIdleConnections(),
                    "total",pool.getTotalConnections(),"waiting",pool.getThreadsAwaitingConnection(),"max",hikari.getMaximumPoolSize()));
        }
        return result;
    }

    public Map<String,Object> database() {
        var result=new LinkedHashMap<String,Object>();
        result.put("sizeMb",db.jdbc.queryForObject("SELECT pg_database_size(current_database())/1048576",Long.class));
        result.put("connections",db.jdbc.queryForList("SELECT coalesce(state,'background') AS state,count(*) AS count FROM pg_stat_activity WHERE datname=current_database() GROUP BY 1 ORDER BY 2 DESC"));
        result.put("maxConnections",db.jdbc.queryForObject("SELECT setting::int FROM pg_settings WHERE name='max_connections'",Integer.class));
        result.put("cacheHitRatio",db.jdbc.queryForObject("SELECT round(sum(blks_hit)::numeric/nullif(sum(blks_hit)+sum(blks_read),0),4) FROM pg_stat_database WHERE datname=current_database()",Double.class));
        result.put("tables",db.jdbc.queryForList("SELECT relname AS name,pg_total_relation_size(relid)/1024 AS size_kb,n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10"));
        return result;
    }
}
