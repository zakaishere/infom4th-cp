package com.cpplatform.competition;

import java.util.*;

/**
 * Contest rating: Elo across every pair of entrants, based on rank alone, so all four scoring systems
 * are comparable. A team plays at its members' average and every member receives the team's change.
 */
public final class Rating {
    public static final int START=1200,PROVISIONAL_CONTESTS=3;
    public record Entrant(UUID entry,int rank,List<UUID> members) {}
    public record Contest(UUID run,List<Entrant> entrants) {}
    public record Change(UUID run,UUID entry,int before,int after) {}
    private Rating() {}

    /** Contests must be in the order they were played. A contest needs two entrants to rate anyone. */
    public static Map<UUID,List<Change>> calculate(List<Contest> contests) {
        Map<UUID,List<Change>> history=new HashMap<>();
        for(Contest contest:contests) {
            int n=contest.entrants().size();
            if(n<2)continue;
            double[] strength=new double[n];
            for(int i=0;i<n;i++)strength[i]=contest.entrants().get(i).members().stream().mapToInt(u->current(history,u)).average().orElse(START);
            for(int i=0;i<n;i++) {
                Entrant me=contest.entrants().get(i);
                double actual=0,expected=0;
                for(int j=0;j<n;j++) {
                    if(i==j)continue;
                    int other=contest.entrants().get(j).rank();
                    actual+=me.rank()<other?1:me.rank()==other?0.5:0;
                    expected+=1/(1+Math.pow(10,(strength[j]-strength[i])/400));
                }
                double swing=(actual-expected)/Math.sqrt(n-1);
                for(UUID user:me.members()) {
                    int before=current(history,user);
                    // New players move faster until the rating has settled.
                    int k=history.getOrDefault(user,List.of()).size()<PROVISIONAL_CONTESTS?80:40;
                    history.computeIfAbsent(user,x->new ArrayList<>()).add(new Change(contest.run(),me.entry(),before,Math.max(0,before+(int)Math.round(k*swing))));
                }
            }
        }
        return history;
    }
    private static int current(Map<UUID,List<Change>> history,UUID user) {
        var changes=history.get(user);
        return changes==null || changes.isEmpty()?START:changes.get(changes.size()-1).after();
    }
}
