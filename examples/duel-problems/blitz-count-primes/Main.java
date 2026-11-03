import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        int n = Integer.parseInt(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
        boolean[] composite = new boolean[n + 1];
        int count = 0;
        for (int i = 2; i <= n; ++i) {
            if (composite[i]) continue;
            ++count;
            for (long j = (long) i * i; j <= n; j += i) composite[(int) j] = true;
        }
        System.out.println(count);
    }
}
