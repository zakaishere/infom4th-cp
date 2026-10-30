package com.cpplatform.competition;

import java.time.*;
import java.util.*;
import java.util.stream.*;

/** Pure profile statistics from one player's counted submissions. */
public final class ProfileStats {
    public static final int POLYGLOT_LANGUAGES=5,SNIPER_STREAK=10,HEATMAP_DAYS=371;
    public record Sub(Instant at,String language,UUID problem,String title,String difficulty,String verdict,Long timeMs,Long memoryKb) {}
    private ProfileStats() {}

    public static Map<String,Object> calculate(List<Sub> submissions,ZoneId zone,Instant now) {
        LocalDate today=now.atZone(zone).toLocalDate();
        var ordered=submissions.stream().sorted(Comparator.comparing(Sub::at)).toList();
        TreeMap<LocalDate,Integer> days=new TreeMap<>();
        Map<String,Integer> verdicts=new TreeMap<>(),languages=new TreeMap<>();
        Map<UUID,Sub> solved=new LinkedHashMap<>();Set<UUID> tried=new HashSet<>();
        Sub fastest=null,lightest=null;
        for(Sub s:ordered) {
            days.merge(s.at().atZone(zone).toLocalDate(),1,Integer::sum);
            tried.add(s.problem());
            if(s.verdict()==null)continue;
            verdicts.merge(s.verdict(),1,Integer::sum);
            if(!s.verdict().equals("ACCEPTED"))continue;
            languages.merge(s.language(),1,Integer::sum);
            solved.putIfAbsent(s.problem(),s);
            if(s.timeMs()!=null && (fastest==null || s.timeMs()<fastest.timeMs()))fastest=s;
            if(s.memoryKb()!=null && (lightest==null || s.memoryKb()<lightest.memoryKb()))lightest=s;
        }
        var result=new LinkedHashMap<String,Object>();
        result.put("today",today.toString());
        LocalDate from=today.minusDays(HEATMAP_DAYS-1);
        result.put("activity",days.tailMap(from,true).entrySet().stream().map(d->Map.of("date",d.getKey().toString(),"count",d.getValue())).toList());
        result.put("current_streak",currentStreak(days.keySet(),today));
        result.put("best_streak",bestStreak(days.navigableKeySet()));
        result.put("submissions",submissions.size());
        result.put("solved",solved.size());
        result.put("tried",tried.size());
        for(String d:List.of("EASY","MEDIUM","HARD"))result.put(d.toLowerCase(Locale.ROOT),solved.values().stream().filter(s->d.equals(s.difficulty())).count());
        result.put("verdicts",verdicts);
        result.put("languages",languages.entrySet().stream().sorted(Map.Entry.<String,Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey())).map(l->Map.of("code",l.getKey(),"accepted",l.getValue())).toList());
        if(fastest!=null)result.put("fastest",Map.of("title",fastest.title(),"ms",fastest.timeMs()));
        if(lightest!=null)result.put("lightest",Map.of("title",lightest.title(),"kb",lightest.memoryKb()));
        return result;
    }

    static int currentStreak(Set<LocalDate> days,LocalDate today) {
        // Today still counts as open: a streak only breaks once a whole day has passed.
        LocalDate day=days.contains(today)?today:today.minusDays(1);
        int streak=0;
        while(days.contains(day)){streak++;day=day.minusDays(1);}
        return streak;
    }
    static int bestStreak(NavigableSet<LocalDate> days) {
        int best=0,run=0;LocalDate previous=null;
        for(LocalDate day:days) {
            run=previous!=null && previous.plusDays(1).equals(day)?run+1:1;
            best=Math.max(best,run);previous=day;
        }
        return best;
    }
    /** The longest run of problems, in the order first tried, each accepted on its first judged submission. */
    public static int bestFirstTryStreak(List<Sub> submissions) {
        Map<UUID,String> first=new LinkedHashMap<>();
        submissions.stream().sorted(Comparator.comparing(Sub::at)).filter(s->s.verdict()!=null && !s.verdict().equals("JUDGE_ERROR")).forEach(s->first.putIfAbsent(s.problem(),s.verdict()));
        int best=0,run=0;
        for(String verdict:first.values()) {
            run=verdict.equals("ACCEPTED")?run+1:0;
            best=Math.max(best,run);
        }
        return best;
    }
    public static int acceptedLanguages(List<Sub> submissions) {
        return submissions.stream().filter(s->"ACCEPTED".equals(s.verdict())).map(Sub::language).collect(Collectors.toSet()).size();
    }
}
