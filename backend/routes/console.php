<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('tasks:process')->everyMinute();
Schedule::command('schedules:process')->everyMinute();
Schedule::command('device:health-check')->everyFiveMinutes();
Schedule::command('notifications:clear')->dailyAt('00:00');
